import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { booksRouter } from "./modules/books/books.routes.js";
import { ticketsRouter } from "./modules/tickets/tickets.routes.js";
import { eventsRouter } from "./realtime/events.routes.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set("trust proxy", 1); // behind the hosting provider's proxy: needed for correct client IPs in rate limiting
  app.use(helmet({ contentSecurityPolicy: false })); // CSP off: swagger-ui and the Vite bundle use inline scripts
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // ---- API (v1) ----
  const api = express.Router();
  api.get("/health", (_req, res) => res.json({ status: "ok" }));
  api.use("/auth", authRouter); // login is public; /me and logout handle auth themselves
  api.use("/books", requireAuth, booksRouter);
  api.use("/tickets", requireAuth, ticketsRouter);
  api.use("/events", requireAuth, eventsRouter);
  api.use("/admin", requireAuth, requireRole("admin"), adminRouter);
  api.use(notFoundHandler);
  app.use("/api/v1", api);

  // ---- API docs ----
  const spec = YAML.parse(fs.readFileSync(path.join(here, "openapi.yaml"), "utf8"));
  app.get("/api/openapi.json", (_req, res) => res.json(spec));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec));

  // ---- Frontend (production build) ----
  // In production the API also serves the built React app, so everything is one origin:
  // no CORS, and the session cookie can stay SameSite=Lax.
  const webDist = path.resolve(here, "../../web/dist");
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
