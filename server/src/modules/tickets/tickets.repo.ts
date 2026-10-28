import type { Queryable } from "../../db/pool.js";
import type { TicketCategory, TicketPriority, TicketStatus } from "./ticket.constants.js";

// Data access for tickets and their messages. Plain SQL with parameterised queries: no string
// interpolation of user input anywhere (dynamic filters push values into `params`).

export interface TicketRow {
  id: number;
  authorId: string;
  authorName: string;
  authorUserId: number;
  bookId: string | null;
  bookTitle: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  category: TicketCategory | null;
  priority: TicketPriority | null;
  aiCategory: TicketCategory | null;
  aiPriority: TicketPriority | null;
  aiReasoning: string | null;
  aiStatus: "pending" | "done" | "failed" | "skipped";
  aiError: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface MessageRow {
  id: number;
  ticketId: number;
  senderId: number;
  senderName: string;
  senderRole: "author" | "admin";
  kind: "author" | "reply" | "internal_note";
  body: string;
  usedAiDraft: boolean;
  createdAt: string;
}

const TICKET_SELECT = `
  SELECT t.id, t.author_id AS "authorId", au.name AS "authorName", a.user_id AS "authorUserId",
         t.book_id AS "bookId", b.title AS "bookTitle", t.subject, t.description, t.status,
         t.category, t.priority, t.ai_category AS "aiCategory", t.ai_priority AS "aiPriority",
         t.ai_reasoning AS "aiReasoning", t.ai_status AS "aiStatus", t.ai_error AS "aiError",
         t.assignee_id AS "assigneeId", asg.name AS "assigneeName",
         t.first_response_at AS "firstResponseAt", t.resolved_at AS "resolvedAt",
         t.created_at AS "createdAt", t.updated_at AS "updatedAt",
         COALESCE(m.last_at, t.created_at) AS "lastMessageAt", COALESCE(m.cnt, 0)::int AS "messageCount"
  FROM tickets t
  JOIN authors a ON a.id = t.author_id
  JOIN users au ON au.id = a.user_id
  LEFT JOIN books b ON b.id = t.book_id
  LEFT JOIN users asg ON asg.id = t.assignee_id
  LEFT JOIN LATERAL (
    SELECT max(created_at) AS last_at, count(*) AS cnt FROM ticket_messages
    WHERE ticket_id = t.id AND kind <> 'internal_note'
  ) m ON TRUE`;

export interface TicketFilters {
  authorId?: string;
  statuses?: TicketStatus[];
  category?: TicketCategory;
  priority?: TicketPriority | "unclassified";
  assignee?: "me" | "unassigned";
  currentUserId?: number;
  from?: string;
  to?: string;
  q?: string;
  sort: "urgency" | "newest" | "oldest";
  limit: number;
  offset: number;
}

// "Urgency" order: active tickets first, then by priority (unclassified tickets sit just below
// critical so a failed AI call can't bury them), then oldest first.
const ORDER_BY: Record<TicketFilters["sort"], string> = {
  urgency: `CASE WHEN t.status IN ('open','in_progress') THEN 0 ELSE 1 END,
            CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 1 END,
            t.created_at ASC`,
  newest: "t.created_at DESC",
  oldest: "t.created_at ASC",
};

export async function listTickets(db: Queryable, f: TicketFilters): Promise<{ rows: TicketRow[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  // Pushes the value and replaces every "?" in the clause with its $n placeholder.
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replaceAll("?", `$${params.length}`));
  };

  if (f.authorId) add("t.author_id = ?", f.authorId);
  if (f.statuses?.length) add("t.status = ANY(?::ticket_status[])", f.statuses);
  if (f.category) add("t.category = ?", f.category);
  if (f.priority === "unclassified") where.push("t.priority IS NULL");
  else if (f.priority) add("t.priority = ?", f.priority);
  if (f.assignee === "unassigned") where.push("t.assignee_id IS NULL");
  else if (f.assignee === "me") add("t.assignee_id = ?", f.currentUserId);
  if (f.from) add("t.created_at >= ?::date", f.from);
  if (f.to) add("t.created_at < (?::date + 1)", f.to); // inclusive of the whole "to" day
  if (f.q) add("(t.subject ILIKE ? OR au.name ILIKE ?)", `%${f.q}%`);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countSql = `SELECT count(*)::int AS total FROM tickets t JOIN authors a ON a.id = t.author_id
                    JOIN users au ON au.id = a.user_id ${whereSql}`;
  const [{ rows }, count] = await Promise.all([
    db.query<TicketRow>(
      `${TICKET_SELECT} ${whereSql} ORDER BY ${ORDER_BY[f.sort]} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.limit, f.offset],
    ),
    db.query<{ total: number }>(countSql, params),
  ]);
  return { rows, total: count.rows[0]!.total };
}

export async function getTicket(db: Queryable, id: number): Promise<TicketRow | null> {
  const { rows } = await db.query<TicketRow>(`${TICKET_SELECT} WHERE t.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function insertTicket(
  db: Queryable,
  t: { authorId: string; bookId: string | null; subject: string; description: string },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO tickets (author_id, book_id, subject, description) VALUES ($1, $2, $3, $4) RETURNING id`,
    [t.authorId, t.bookId, t.subject, t.description],
  );
  return rows[0]!.id;
}

export interface TicketPatch {
  status?: TicketStatus;
  category?: TicketCategory;
  priority?: TicketPriority;
  assigneeId?: number | null;
}

export async function updateTicket(db: Queryable, id: number, patch: TicketPatch): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (patch.status !== undefined) {
    set("status", patch.status);
    // Track when a ticket was resolved. Reopening clears it.
    sets.push(patch.status === "resolved" || patch.status === "closed" ? "resolved_at = COALESCE(resolved_at, now())" : "resolved_at = NULL");
  }
  if (patch.category !== undefined) set("category", patch.category);
  if (patch.priority !== undefined) set("priority", patch.priority);
  if (patch.assigneeId !== undefined) set("assignee_id", patch.assigneeId);
  if (!sets.length) return;
  params.push(id);
  await db.query(`UPDATE tickets SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length}`, params);
}

export async function insertMessage(
  db: Queryable,
  m: { ticketId: number; senderId: number; kind: MessageRow["kind"]; body: string; usedAiDraft?: boolean },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO ticket_messages (ticket_id, sender_id, kind, body, used_ai_draft) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [m.ticketId, m.senderId, m.kind, m.body, m.usedAiDraft ?? false],
  );
  await db.query(
    `UPDATE tickets SET updated_at = now()
       ${m.kind === "reply" ? ", first_response_at = COALESCE(first_response_at, now())" : ""}
     WHERE id = $1`,
    [m.ticketId],
  );
  return rows[0]!.id;
}

export async function listMessages(db: Queryable, ticketId: number, includeInternal: boolean): Promise<MessageRow[]> {
  const { rows } = await db.query<MessageRow>(
    `SELECT m.id, m.ticket_id AS "ticketId", m.sender_id AS "senderId", u.name AS "senderName",
            u.role AS "senderRole", m.kind, m.body, m.used_ai_draft AS "usedAiDraft", m.created_at AS "createdAt"
     FROM ticket_messages m JOIN users u ON u.id = m.sender_id
     WHERE m.ticket_id = $1 ${includeInternal ? "" : "AND m.kind <> 'internal_note'"}
     ORDER BY m.created_at, m.id`,
    [ticketId],
  );
  return rows;
}

/** Stores the AI's classification. Only fills effective category/priority if an admin hasn't already set them. */
export async function saveClassification(
  db: Queryable,
  id: number,
  c: { category: TicketCategory; priority: TicketPriority; reasoning: string },
): Promise<void> {
  await db.query(
    `UPDATE tickets SET ai_category = $2, ai_priority = $3, ai_reasoning = $4, ai_status = 'done', ai_error = NULL,
       category = COALESCE(category, $2), priority = COALESCE(priority, $3), updated_at = now()
     WHERE id = $1`,
    [id, c.category, c.priority, c.reasoning],
  );
}

export async function setAiStatus(db: Queryable, id: number, status: "pending" | "failed" | "skipped", error?: string): Promise<void> {
  await db.query(`UPDATE tickets SET ai_status = $2, ai_error = $3, updated_at = now() WHERE id = $1`, [id, status, error ?? null]);
}

export async function listTicketIdsWithAiStatus(db: Queryable, status: "pending"): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM tickets WHERE ai_status = $1 ORDER BY id`, [status]);
  return rows.map((r) => r.id);
}

export interface DraftRow {
  ticketId: number;
  body: string;
  basedOnMessageId: number | null;
  model: string;
  createdAt: string;
}

export async function getDraft(db: Queryable, ticketId: number): Promise<DraftRow | null> {
  const { rows } = await db.query<DraftRow>(
    `SELECT ticket_id AS "ticketId", body, based_on_message_id AS "basedOnMessageId", model, created_at AS "createdAt"
     FROM ai_drafts WHERE ticket_id = $1`,
    [ticketId],
  );
  return rows[0] ?? null;
}

export async function saveDraft(db: Queryable, d: { ticketId: number; body: string; basedOnMessageId: number | null; model: string }): Promise<void> {
  await db.query(
    `INSERT INTO ai_drafts (ticket_id, body, based_on_message_id, model) VALUES ($1, $2, $3, $4)
     ON CONFLICT (ticket_id) DO UPDATE SET body = EXCLUDED.body, based_on_message_id = EXCLUDED.based_on_message_id,
       model = EXCLUDED.model, created_at = now()`,
    [d.ticketId, d.body, d.basedOnMessageId, d.model],
  );
}

export async function deleteDraft(db: Queryable, ticketId: number): Promise<void> {
  await db.query(`DELETE FROM ai_drafts WHERE ticket_id = $1`, [ticketId]);
}
