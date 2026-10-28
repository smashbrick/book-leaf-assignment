import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { requireAuth } from "./middleware/auth.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { booksRouter } from "./modules/books/books.routes.js";
import { ticketsRouter } from "./modules/tickets/tickets.routes.js";
import { eventsRouter } from "./realtime/events.routes.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false })); // CSP off: Vite's built index.html uses an inline module script
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.get("/health", (_req, res) => res.json({ status: "ok" }));
  api.use("/auth", authRouter); // login is public; /me checks the session itself
  api.use("/books", requireAuth, booksRouter);
  api.use("/tickets", requireAuth, ticketsRouter);
  api.use("/events", requireAuth, eventsRouter);
  api.use(notFoundHandler);
  app.use("/api/v1", api);

  // In production Express also serves the built React app, so the UI and API share one origin
  // (no CORS setup needed, and the session cookie just works).
  const webDist = path.resolve(here, "../../web/dist");
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
