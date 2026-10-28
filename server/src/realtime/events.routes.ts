import { Router } from "express";
import { subscribe } from "./bus.js";

export const eventsRouter = Router();

/**
 * Server-Sent Events stream. The browser's EventSource reconnects automatically and sends the
 * session cookie, so this needs no extra auth handling beyond the requireAuth in front of it.
 * SSE fits here because updates only flow server → client; clients send changes over REST.
 */
eventsRouter.get("/", (req, res) => {
  const user = req.user!;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // stop reverse proxies from buffering the stream
  });
  res.write("retry: 3000\n\n");

  const unsubscribe = subscribe((event) => {
    if (user.role === "author" && (event.authorId !== user.authorId || event.staffOnly)) return;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify({ ticketId: event.ticketId })}\n\n`);
  });

  // Comment line every 25s so proxies and load balancers don't close an idle connection.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
