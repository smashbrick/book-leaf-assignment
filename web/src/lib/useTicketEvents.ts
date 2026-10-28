import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { keys } from "../api/hooks";

/**
 * Subscribes to the server's Server-Sent Events stream and refreshes affected data.
 * Events only carry a ticket ID. The actual data is re-fetched through the normal REST endpoints,
 * so there is one source of truth and one place where access control happens.
 * EventSource reconnects by itself after network drops or server restarts.
 */
export function useTicketEvents(enabled: boolean): boolean {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/v1/events");
    const onEvent = (e: MessageEvent<string>) => {
      const { ticketId } = JSON.parse(e.data) as { ticketId: number };
      void qc.invalidateQueries({ queryKey: keys.ticket(ticketId) });
      void qc.invalidateQueries({ queryKey: ["tickets", "list"] });
      void qc.invalidateQueries({ queryKey: keys.stats });
    };
    for (const type of ["ticket.created", "ticket.updated", "message.created"]) source.addEventListener(type, onEvent);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [enabled, qc]);

  return connected;
}
