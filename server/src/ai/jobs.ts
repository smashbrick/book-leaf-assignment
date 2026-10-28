import { pool } from "../db/pool.js";
import { getTicket, listTicketIdsWithAiStatus, saveClassification, setAiStatus } from "../modules/tickets/tickets.repo.js";
import { publish } from "../realtime/bus.js";
import { classifyTicket } from "./classifier.js";
import { AiError } from "./client.js";

/**
 * Background classification. Tickets are saved first and classified afterwards, so an author
 * never waits on (or is blocked by) the AI. On failure the ticket stays usable, gets marked
 * ai_status='failed' with a reason, and an admin can retry or classify it by hand.
 *
 * Jobs run in-process (fire-and-forget). In production this would be a durable queue
 * (BullMQ, SQS, pg-boss) so jobs survive restarts; requeuePendingClassifications() covers that gap here.
 */
export async function runClassification(ticketId: number): Promise<void> {
  const ticket = await getTicket(pool, ticketId);
  if (!ticket) return;

  try {
    const { rows } = ticket.bookId
      ? await pool.query<{ title: string; status: string }>("SELECT title, status FROM books WHERE id = $1", [ticket.bookId])
      : { rows: [] };
    const book = rows[0];
    const result = await classifyTicket({
      ticketId,
      subject: ticket.subject,
      description: ticket.description,
      bookContext: book ? `${book.title} (status: ${book.status})` : null,
    });
    await saveClassification(pool, ticketId, result);
  } catch (err) {
    const reason = err instanceof AiError ? err.message : "Unexpected error during classification";
    if (!(err instanceof AiError)) console.error(`[ai] classification crashed for ticket ${ticketId}`, err);
    await setAiStatus(pool, ticketId, "failed", reason);
  }
  publish({ type: "ticket.updated", ticketId, authorId: ticket.authorId, staffOnly: true });
}

/** Starts classification without awaiting it. Errors are already handled inside runClassification. */
export function enqueueClassification(ticketId: number): void {
  setImmediate(() => {
    runClassification(ticketId).catch((err) => console.error(`[ai] job failed for ticket ${ticketId}`, err));
  });
}

/**
 * On boot, pick up tickets left 'pending' (seeded tickets, or jobs lost to a restart).
 * Runs sequentially so a backlog doesn't burst through a free-tier rate limit.
 */
export async function requeuePendingClassifications(): Promise<void> {
  const ids = await listTicketIdsWithAiStatus(pool, "pending");
  if (!ids.length) return;
  console.log(`[ai] classifying ${ids.length} pending ticket(s)`);
  for (const id of ids) await runClassification(id);
}
