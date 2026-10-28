import type { Queryable } from "../../db/pool.js";
import type { TicketCategory, TicketPriority, TicketStatus } from "./ticket.constants.js";

// SQL for tickets, messages and AI drafts. All queries are parameterised.

export interface TicketRow {
  id: number;
  authorId: string;
  authorName: string;
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
  aiStatus: "pending" | "done" | "failed";
  aiError: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: number;
  senderName: string;
  kind: "author" | "reply" | "internal_note";
  body: string;
  createdAt: string;
}

const TICKET_SELECT = `
  SELECT t.id, t.author_id AS "authorId", au.name AS "authorName", t.book_id AS "bookId", b.title AS "bookTitle",
         t.subject, t.description, t.status, t.category, t.priority,
         t.ai_category AS "aiCategory", t.ai_priority AS "aiPriority", t.ai_reasoning AS "aiReasoning",
         t.ai_status AS "aiStatus", t.ai_error AS "aiError",
         t.assignee_id AS "assigneeId", asg.name AS "assigneeName",
         t.created_at AS "createdAt", t.updated_at AS "updatedAt"
  FROM tickets t
  JOIN authors a ON a.id = t.author_id
  JOIN users au ON au.id = a.user_id
  LEFT JOIN books b ON b.id = t.book_id
  LEFT JOIN users asg ON asg.id = t.assignee_id`;

export interface TicketFilters {
  authorId?: string;
  statuses?: TicketStatus[];
  category?: TicketCategory;
  priority?: TicketPriority | "unclassified";
  from?: string;
  to?: string;
}

export async function listTickets(db: Queryable, f: TicketFilters): Promise<TicketRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("?", `$${params.length}`));
  };
  if (f.authorId) add("t.author_id = ?", f.authorId);
  if (f.statuses?.length) add("t.status = ANY(?::ticket_status[])", f.statuses);
  if (f.category) add("t.category = ?", f.category);
  if (f.priority === "unclassified") where.push("t.priority IS NULL");
  else if (f.priority) add("t.priority = ?", f.priority);
  if (f.from) add("t.created_at >= ?::date", f.from);
  if (f.to) add("t.created_at < ?::date + 1", f.to); // include the whole "to" day

  // Most urgent first: open/in-progress tickets, then by priority, then oldest first.
  // Unclassified tickets (AI failed or still running) sit right after critical so they can't get buried.
  const { rows } = await db.query<TicketRow>(
    `${TICKET_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY CASE WHEN t.status IN ('open', 'in_progress') THEN 0 ELSE 1 END,
              CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 1 END,
              t.created_at`,
    params,
  );
  return rows;
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
  // Only whitelisted column names ever reach the SQL string; values go in as parameters.
  const columns = { status: "status", category: "category", priority: "priority", assigneeId: "assignee_id" } as const;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    const value = patch[key as keyof TicketPatch];
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  if (!sets.length) return;
  params.push(id);
  await db.query(`UPDATE tickets SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length}`, params);
}

export async function insertMessage(
  db: Queryable,
  m: { ticketId: number; senderId: number; kind: MessageRow["kind"]; body: string },
): Promise<void> {
  await db.query(`INSERT INTO ticket_messages (ticket_id, sender_id, kind, body) VALUES ($1, $2, $3, $4)`, [
    m.ticketId, m.senderId, m.kind, m.body,
  ]);
  await db.query(`UPDATE tickets SET updated_at = now() WHERE id = $1`, [m.ticketId]);
}

export async function listMessages(db: Queryable, ticketId: number, includeInternal: boolean): Promise<MessageRow[]> {
  const { rows } = await db.query<MessageRow>(
    `SELECT m.id, u.name AS "senderName", m.kind, m.body, m.created_at AS "createdAt"
     FROM ticket_messages m JOIN users u ON u.id = m.sender_id
     WHERE m.ticket_id = $1 ${includeInternal ? "" : "AND m.kind <> 'internal_note'"}
     ORDER BY m.created_at, m.id`,
    [ticketId],
  );
  return rows;
}

/** Saves the AI's answer. Only fills category/priority if an admin hasn't already set them. */
export async function saveClassification(
  db: Queryable,
  id: number,
  c: { category: TicketCategory; priority: TicketPriority; reasoning: string },
): Promise<void> {
  await db.query(
    `UPDATE tickets SET ai_category = $2, ai_priority = $3, ai_reasoning = $4, ai_status = 'done', ai_error = NULL,
       category = COALESCE(category, $2), priority = COALESCE(priority, $3)
     WHERE id = $1`,
    [id, c.category, c.priority, c.reasoning],
  );
}

export async function setAiStatus(db: Queryable, id: number, status: "pending" | "failed", error?: string): Promise<void> {
  await db.query(`UPDATE tickets SET ai_status = $2, ai_error = $3 WHERE id = $1`, [id, status, error ?? null]);
}

export async function listPendingTicketIds(db: Queryable): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(`SELECT id FROM tickets WHERE ai_status = 'pending' ORDER BY id`);
  return rows.map((r) => r.id);
}

export async function getDraft(db: Queryable, ticketId: number): Promise<string | null> {
  const { rows } = await db.query<{ body: string }>(`SELECT body FROM ai_drafts WHERE ticket_id = $1`, [ticketId]);
  return rows[0]?.body ?? null;
}

export async function saveDraft(db: Queryable, ticketId: number, body: string): Promise<void> {
  await db.query(
    `INSERT INTO ai_drafts (ticket_id, body) VALUES ($1, $2)
     ON CONFLICT (ticket_id) DO UPDATE SET body = EXCLUDED.body, created_at = now()`,
    [ticketId, body],
  );
}

export async function deleteDraft(db: Queryable, ticketId: number): Promise<void> {
  await db.query(`DELETE FROM ai_drafts WHERE ticket_id = $1`, [ticketId]);
}
