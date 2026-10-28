import { pool } from "../db/pool.js";
import { getBook } from "../modules/books/books.repo.js";
import { getTicket, listPendingTicketIds, saveClassification, setAiStatus } from "../modules/tickets/tickets.repo.js";
import { publish } from "../realtime/bus.js";
import { classifyTicket } from "./classifier.js";
import { AiError } from "./client.js";

/**
 * Background classification. Tickets are saved first and classified afterwards, so an author never
 * waits on (or is blocked by) the AI. On failure the ticket stays usable: it's marked ai_status='failed'
 * with the reason, and an admin can retry or set the category/priority by hand.
 *
 * Runs in-process (fire and forget). Fine for this app's size; a bigger system would use a job queue.
 */
export async function runClassification(ticketId: number): Promise<void> {
  const ticket = await getTicket(pool, ticketId);
  if (!ticket) return;

  try {
    const book = ticket.bookId ? await getBook(pool, ticket.bookId) : null;
    const result = await classifyTicket({
      ticketId,
      subject: ticket.subject,
      description: ticket.description,
      bookContext: book ? `${book.title} (status: ${book.status})` : null,
    });
    await saveClassification(pool, ticketId, result);
  } catch (err) {
    if (!(err instanceof AiError)) console.error(`[ai] classification crashed for ticket ${ticketId}`, err);
    const reason = err instanceof AiError ? err.message : "Unexpected error during classification";
    await setAiStatus(pool, ticketId, "failed", reason);
  }
  publish({ type: "ticket.updated", ticketId, authorId: ticket.authorId, staffOnly: true }); // admins' queue refreshes live
}

/** Starts classification without awaiting it. Errors are already handled inside runClassification. */
export function enqueueClassification(ticketId: number): void {
  setImmediate(() => {
    runClassification(ticketId).catch((err) => console.error(`[ai] job failed for ticket ${ticketId}`, err));
  });
}

/** On startup, classify tickets still 'pending'. One at a time, to stay under free-tier rate limits. */
export async function requeuePendingClassifications(): Promise<void> {
  const ids = await listPendingTicketIds(pool);
  if (!ids.length) return;
  console.log(`[ai] classifying ${ids.length} pending ticket(s)`);
  for (const id of ids) await runClassification(id);
}
