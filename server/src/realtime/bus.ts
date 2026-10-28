import { EventEmitter } from "node:events";

/**
 * In-process pub/sub for ticket changes. Events carry IDs only, never ticket content: clients
 * re-fetch through the normal REST endpoints, so access control is enforced in one place.
 *
 * This works for a single server instance. With several instances, swap the EventEmitter for
 * Postgres LISTEN/NOTIFY or Redis pub/sub. The publish/subscribe interface stays the same.
 */
export interface TicketEvent {
  type: "ticket.created" | "ticket.updated" | "message.created";
  ticketId: number;
  /** Owner of the ticket. Authors only receive events for their own tickets. */
  authorId: string;
  /** Staff-only changes (internal notes, AI classification) are never sent to authors. */
  staffOnly?: boolean;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(0); // one listener per open browser tab

export function publish(event: TicketEvent): void {
  emitter.emit("ticket", event);
}

export function subscribe(listener: (event: TicketEvent) => void): () => void {
  emitter.on("ticket", listener);
  return () => emitter.off("ticket", listener);
}
