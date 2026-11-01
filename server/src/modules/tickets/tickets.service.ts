import { AiError } from "../../ai/client.js";
import { draftReply } from "../../ai/drafter.js";
import { enqueueClassification } from "../../ai/jobs.js";
import { pool, withTransaction } from "../../db/pool.js";
import { badRequest, HttpError, notFound } from "../../lib/errors.js";
import { royaltySummary } from "../../lib/royalty.js";
import type { AuthUser } from "../../middleware/auth.js";
import { publish } from "../../realtime/bus.js";
import { getBook, listBooksByAuthor } from "../books/books.repo.js";
import * as repo from "./tickets.repo.js";

// Ticket rules: who can see/do what, and what happens as a side effect (live events, AI jobs).
// Routes handle HTTP and validation; the repo handles SQL.

/** What authors get back: no priority, AI fields or assignee. Those are for the support team. */
function authorView(t: repo.TicketRow) {
  const { id, subject, description, status, category, bookId, bookTitle, latestReply, createdAt, updatedAt } = t;
  return { id, subject, description, status, category, bookId, bookTitle, latestReply, createdAt, updatedAt };
}

const viewFor = (user: AuthUser, t: repo.TicketRow) => (user.role === "admin" ? t : authorView(t));

/** Loads a ticket the user may see. Another author's ticket is a 404 (not 403) so IDs can't be probed. */
async function loadTicket(user: AuthUser, id: number): Promise<repo.TicketRow> {
  const ticket = await repo.getTicket(pool, id);
  if (!ticket || (user.role === "author" && ticket.authorId !== user.authorId)) throw notFound("Ticket");
  return ticket;
}

export async function listTickets(user: AuthUser, filters: repo.TicketFilters) {
  // Authors only ever see their own tickets, whatever filters they send.
  const rows = await repo.listTickets(pool, { ...filters, authorId: user.role === "author" ? user.authorId! : undefined });
  return rows.map((t) => viewFor(user, t));
}

export async function getTicketDetail(user: AuthUser, id: number) {
  const ticket = await loadTicket(user, id);
  const messages = await repo.listMessages(pool, id, user.role === "admin");
  if (user.role !== "admin") return { ...authorView(ticket), messages };

  // Admins also get the author's book and royalty info, so they can answer without looking it up.
  const books = await listBooksByAuthor(pool, ticket.authorId);
  return { ...ticket, messages, book: books.find((b) => b.id === ticket.bookId) ?? null, royalty: royaltySummary(books) };
}

export async function createTicket(user: AuthUser, input: { bookId: string | null; subject: string; description: string }) {
  const authorId = user.authorId!;
  if (input.bookId) {
    const book = await getBook(pool, input.bookId);
    if (!book || book.authorId !== authorId) throw badRequest("Selected book does not belong to your account");
  }

  const id = await withTransaction(async (db) => {
    const ticketId = await repo.insertTicket(db, { authorId, ...input });
    // The description is also the first message, so the conversation shows as one thread.
    await repo.insertMessage(db, { ticketId, senderId: user.id, kind: "author", body: input.description });
    return ticketId;
  });

  publish({ type: "ticket.created", ticketId: id, authorId });
  // Classify after saving, in the background: the author never waits for the AI, and an AI outage can't block tickets.
  enqueueClassification(id);
  return getTicketDetail(user, id);
}

export async function updateTicket(user: AuthUser, id: number, patch: repo.TicketPatch) {
  const ticket = await loadTicket(user, id);
  // Admins assign tickets to themselves (or unassign).
  if (patch.assigneeId != null && patch.assigneeId !== user.id) throw badRequest("You can only assign tickets to yourself");
  await repo.updateTicket(pool, id, patch);
  publish({ type: "ticket.updated", ticketId: id, authorId: ticket.authorId });
  return getTicketDetail(user, id);
}

/** Admin reply (visible to the author) or internal note (staff only). */
export async function addStaffMessage(user: AuthUser, id: number, input: { body: string; internal: boolean }) {
  const ticket = await loadTicket(user, id);
  await withTransaction(async (db) => {
    await repo.insertMessage(db, { ticketId: id, senderId: user.id, kind: input.internal ? "internal_note" : "reply", body: input.body });
    if (!input.internal) {
      if (ticket.status === "open") await repo.updateTicket(db, id, { status: "in_progress" });
      await repo.deleteDraft(db, id); // the draft has been used
    }
  });
  // Internal notes never trigger an event for the author.
  publish({ type: "message.created", ticketId: id, authorId: ticket.authorId, staffOnly: input.internal });
  return getTicketDetail(user, id);
}

/** Author follow-up on their own ticket. A resolved ticket goes back to Open; a closed one stays closed. */
export async function addAuthorMessage(user: AuthUser, id: number, body: string) {
  const ticket = await loadTicket(user, id);
  if (ticket.status === "closed") throw badRequest("This ticket is closed. Please raise a new ticket.");
  await withTransaction(async (db) => {
    await repo.insertMessage(db, { ticketId: id, senderId: user.id, kind: "author", body });
    if (ticket.status === "resolved") await repo.updateTicket(db, id, { status: "open" });
    await repo.deleteDraft(db, id); // a saved draft no longer answers the latest message
  });
  publish({ type: "message.created", ticketId: id, authorId: ticket.authorId });
  return getTicketDetail(user, id);
}

/** "Retry AI" after a failed classification. */
export async function retryClassification(user: AuthUser, id: number) {
  await loadTicket(user, id);
  await repo.setAiStatus(pool, id, "pending");
  enqueueClassification(id);
  return getTicketDetail(user, id);
}

/** The author's messages after BookLeaf's latest reply (the first message is the description, so it's skipped). */
function followUpsSinceLastReply(messages: repo.MessageRow[]): string[] {
  let start = 1;
  messages.forEach((m, i) => {
    if (m.kind === "reply") start = i + 1;
  });
  return messages.slice(start).filter((m) => m.kind === "author").map((m) => m.body);
}

/**
 * Returns the AI draft for a ticket, generating it the first time. The draft is saved, so reopening the
 * ticket doesn't cost another AI call. `regenerate` forces a fresh one.
 */
export async function getOrCreateDraft(user: AuthUser, id: number, regenerate: boolean) {
  const ticket = await loadTicket(user, id);
  const saved = regenerate ? null : await repo.getDraft(pool, id);
  if (saved) return { body: saved };

  const books = await listBooksByAuthor(pool, ticket.authorId);
  const messages = await repo.listMessages(pool, id, true);
  // Prefer the admin-confirmed category, else the AI's. With neither, "general" gets the full knowledge base.
  const category = ticket.category ?? ticket.aiCategory ?? "general_inquiry";
  try {
    const body = await draftReply({
      ticketId: id,
      category,
      subject: ticket.subject,
      description: ticket.description,
      authorFirstName: ticket.authorName.split(" ")[0]!,
      agentFirstName: user.name.split(" ")[0]!,
      book: books.find((b) => b.id === ticket.bookId) ?? null,
      // Royalty figures only where they're relevant, to keep the prompt small.
      royalty: category === "royalty_payments" || category === "general_inquiry" ? royaltySummary(books) : null,
      previousReplies: messages.filter((m) => m.kind === "reply").map((m) => m.body),
      authorFollowUps: followUpsSinceLastReply(messages),
      internalNotes: messages.filter((m) => m.kind === "internal_note").map((m) => m.body),
      today: new Date().toISOString().slice(0, 10),
    });
    await repo.saveDraft(pool, id, body);
    return { body };
  } catch (err) {
    // 503 tells the UI the AI is unavailable, so it shows an empty editor for a manual reply.
    if (err instanceof AiError) throw new HttpError(503, "AI_UNAVAILABLE", `${err.message}. You can write the reply manually.`);
    throw err;
  }
}
