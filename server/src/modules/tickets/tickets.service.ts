import { AiError } from "../../ai/client.js";
import { draftReply } from "../../ai/drafter.js";
import { enqueueClassification } from "../../ai/jobs.js";
import { config } from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { badRequest, conflict, HttpError, notFound } from "../../lib/errors.js";
import { royaltySummary } from "../../lib/royalty.js";
import type { AuthUser } from "../../middleware/auth.js";
import { publish } from "../../realtime/bus.js";
import { getBook, listBooksByAuthor } from "../books/books.repo.js";
import { FIRST_RESPONSE_SLA_HOURS, type TicketStatus } from "./ticket.constants.js";
import * as repo from "./tickets.repo.js";

// Business rules for the ticket lifecycle. Routes handle HTTP, the repo handles SQL, and this
// layer decides who may do what and what happens as a side effect (events, AI jobs).

// ---------- Views: what each role is allowed to see ----------

/** Authors don't see priority, AI internals or assignment. Those are operational details. */
function authorView(t: repo.TicketRow) {
  return {
    id: t.id,
    subject: t.subject,
    description: t.description,
    status: t.status,
    category: t.category,
    bookId: t.bookId,
    bookTitle: t.bookTitle,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastMessageAt: t.lastMessageAt,
  };
}

function staffView(t: repo.TicketRow) {
  const { authorUserId: _omit, ...rest } = t;
  // SLA: hours a ticket may wait for its first reply. Unclassified tickets use the "high" clock.
  const slaHours = FIRST_RESPONSE_SLA_HOURS[t.priority ?? "high"];
  const waitingHours = (Date.now() - new Date(t.createdAt).getTime()) / 3_600_000;
  const active = t.status === "open" || t.status === "in_progress";
  return {
    ...rest,
    slaHours,
    firstResponseOverdue: active && !t.firstResponseAt && waitingHours > slaHours,
  };
}

const viewFor = (user: AuthUser, t: repo.TicketRow) => (user.role === "admin" ? staffView(t) : authorView(t));

/** Loads a ticket the user may access. 404 (not 403) for others' tickets, so IDs can't be probed. */
async function loadAccessible(user: AuthUser, id: number): Promise<repo.TicketRow> {
  const ticket = await repo.getTicket(pool, id);
  if (!ticket || (user.role === "author" && ticket.authorId !== user.authorId)) throw notFound("Ticket");
  return ticket;
}

// ---------- Queries ----------

export async function listTickets(user: AuthUser, filters: Omit<repo.TicketFilters, "authorId" | "currentUserId">) {
  const scoped: repo.TicketFilters = {
    ...filters,
    currentUserId: user.id,
    // Authors are always scoped to their own tickets, whatever filters they send.
    authorId: user.role === "author" ? user.authorId! : undefined,
  };
  const { rows, total } = await repo.listTickets(pool, scoped);
  return { data: rows.map((t) => viewFor(user, t)), total };
}

export async function getTicketDetail(user: AuthUser, id: number) {
  const ticket = await loadAccessible(user, id);
  const messages = await repo.listMessages(pool, id, user.role === "admin");
  const view = { ...viewFor(user, ticket), messages };
  if (user.role !== "admin") return view;

  // Staff get the author's book and royalty context alongside the ticket, so they can answer without digging.
  const books = await listBooksByAuthor(pool, ticket.authorId);
  return {
    ...view,
    book: books.find((b) => b.id === ticket.bookId) ?? null,
    royalty: royaltySummary(books),
  };
}

// ---------- Commands ----------

export async function createTicket(user: AuthUser, input: { bookId: string | null; subject: string; description: string }) {
  const authorId = user.authorId!;
  if (input.bookId) {
    const book = await getBook(pool, input.bookId);
    if (!book || book.authorId !== authorId) throw badRequest("Selected book does not belong to your account");
  }

  const id = await withTransaction(async (db) => {
    const ticketId = await repo.insertTicket(db, { authorId, ...input });
    // The description is also the first message, so the conversation view is one uniform thread.
    await repo.insertMessage(db, { ticketId, senderId: user.id, kind: "author", body: input.description });
    return ticketId;
  });

  publish({ type: "ticket.created", ticketId: id, authorId });
  enqueueClassification(id); // after commit, in the background
  return getTicketDetail(user, id);
}

export async function updateTicket(user: AuthUser, id: number, patch: repo.TicketPatch) {
  const ticket = await loadAccessible(user, id);
  if (patch.assigneeId != null) {
    const { rows } = await pool.query("SELECT 1 FROM users WHERE id = $1 AND role = 'admin'", [patch.assigneeId]);
    if (!rows.length) throw badRequest("Tickets can only be assigned to admin users");
  }
  await repo.updateTicket(pool, id, patch);
  // Only a status change is visible to the author. Category, priority and assignment are staff-only.
  publish({ type: "ticket.updated", ticketId: id, authorId: ticket.authorId, staffOnly: patch.status === undefined });
  return getTicketDetail(user, id);
}

export async function addMessage(
  user: AuthUser,
  id: number,
  input: { body: string; internal?: boolean; usedAiDraft?: boolean; setStatus?: TicketStatus },
) {
  const ticket = await loadAccessible(user, id);

  if (user.role === "author") {
    if (ticket.status === "closed") throw conflict("This ticket is closed. Please open a new ticket for further help.");
    await withTransaction(async (db) => {
      await repo.insertMessage(db, { ticketId: id, senderId: user.id, kind: "author", body: input.body });
      // A follow-up on a resolved ticket means it isn't actually resolved, so reopen it.
      if (ticket.status === "resolved") await repo.updateTicket(db, id, { status: "open" });
    });
    publish({ type: "message.created", ticketId: id, authorId: ticket.authorId });
    return getTicketDetail(user, id);
  }

  const kind = input.internal ? "internal_note" : "reply";
  await withTransaction(async (db) => {
    await repo.insertMessage(db, { ticketId: id, senderId: user.id, kind, body: input.body, usedAiDraft: input.usedAiDraft });
    if (kind === "reply") {
      // Replying moves a new ticket into progress unless the admin picked a status explicitly.
      const status = input.setStatus ?? (ticket.status === "open" ? "in_progress" : undefined);
      // Replying without an assignee picks the ticket up, so two admins don't work the same ticket.
      const assigneeId = ticket.assigneeId ?? user.id;
      await repo.updateTicket(db, id, { status, assigneeId });
      await repo.deleteDraft(db, id); // the draft has been used or superseded
    }
  });
  publish({ type: "message.created", ticketId: id, authorId: ticket.authorId, staffOnly: kind === "internal_note" });
  return getTicketDetail(user, id);
}

/** Admin "Retry AI": clears the failure and re-runs classification in the background. */
export async function retryClassification(user: AuthUser, id: number) {
  await loadAccessible(user, id);
  await repo.setAiStatus(pool, id, "pending");
  enqueueClassification(id);
  return getTicketDetail(user, id);
}

// ---------- AI drafts ----------

/**
 * Returns the AI draft for a ticket, generating it on first request. The draft is cached and reused
 * until the author writes something new or the admin asks to regenerate, so opening a ticket
 * twice doesn't pay for two drafts.
 */
export async function getOrCreateDraft(user: AuthUser, id: number, opts: { regenerate: boolean }) {
  const ticket = await loadAccessible(user, id);
  const messages = await repo.listMessages(pool, id, true);
  const latestAuthorMessage = messages.filter((m) => m.kind === "author").at(-1);

  const cached = await repo.getDraft(pool, id);
  if (cached && !opts.regenerate && cached.basedOnMessageId === (latestAuthorMessage?.id ?? null)) {
    return { body: cached.body, model: cached.model, createdAt: cached.createdAt, cached: true };
  }

  const books = await listBooksByAuthor(pool, ticket.authorId);
  // Use the admin-confirmed category if set, else the AI's, else treat it as general (which gets the full KB).
  const category = ticket.category ?? ticket.aiCategory ?? "general_inquiry";
  try {
    const body = await draftReply({
      ticketId: id,
      category,
      subject: ticket.subject,
      authorFirstName: ticket.authorName.split(" ")[0]!,
      agentFirstName: user.name.split(" ")[0]!,
      book: books.find((b) => b.id === ticket.bookId) ?? null,
      // Royalty context only where it's relevant, to keep the prompt small.
      royalty: category === "royalty_payments" || category === "general_inquiry" ? royaltySummary(books) : null,
      thread: messages
        .filter((m) => m.kind !== "internal_note")
        .map((m) => ({ from: m.kind === "author" ? ("author" as const) : ("bookleaf" as const), body: m.body })),
      internalNotes: messages.filter((m) => m.kind === "internal_note").slice(-3).map((m) => m.body),
      today: new Date().toISOString().slice(0, 10),
    });
    const draft = { ticketId: id, body, basedOnMessageId: latestAuthorMessage?.id ?? null, model: config.AI_MODEL };
    await repo.saveDraft(pool, draft);
    return { body, model: draft.model, createdAt: new Date().toISOString(), cached: false };
  } catch (err) {
    if (err instanceof AiError) {
      // 503 tells the UI "AI is unavailable": it shows an empty editor so the admin can write manually.
      throw new HttpError(503, "AI_UNAVAILABLE", `AI draft unavailable: ${err.message}. You can write a reply manually.`);
    }
    throw err;
  }
}
