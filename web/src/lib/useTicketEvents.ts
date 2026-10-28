import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { keys } from "../api/hooks";

/**
 * Listens to the server's Server-Sent Events stream. Each event only says which ticket changed;
 * we then re-fetch it through the normal API. EventSource reconnects on its own if the connection drops.
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
    };
    for (const type of ["ticket.created", "ticket.updated", "message.created"]) source.addEventListener(type, onEvent);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [enabled, qc]);

  return connected;
}
