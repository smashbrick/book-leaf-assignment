import { EventEmitter } from "node:events";

/**
 * In-process pub/sub for ticket changes, used by the SSE endpoint. Events carry only the ticket ID:
 * the browser re-fetches the ticket through the normal API, so permissions are checked in one place.
 * (Works for a single server instance, which is all this app needs.)
 */
export interface TicketEvent {
  type: "ticket.created" | "ticket.updated" | "message.created";
  ticketId: number;
  /** Owner of the ticket. Authors only receive events for their own tickets. */
  authorId: string;
  /** Staff-only changes (internal notes, AI classification) aren't sent to authors. */
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
