import { Router } from "express";
import { z } from "zod";
import { parseBody, parseParams, parseQuery } from "../../lib/validate.js";
import { requireRole } from "../../middleware/auth.js";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "./ticket.constants.js";
import * as service from "./tickets.service.js";

export const ticketsRouter = Router();

// Capped at Postgres INTEGER's maximum, so a huge ID is a 400 here instead of a database error.
const IdParams = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });
// Rejects impossible dates like 2026-02-30 too, which Postgres would otherwise fail on.
const isoDate = z.iso.date("Use a real date in YYYY-MM-DD format");

const ListQuery = z.object({
  // e.g. ?status=open,in_progress
  status: z
    .string()
    .transform((s) => s.split(",").filter(Boolean))
    .pipe(z.array(z.enum(TICKET_STATUSES)))
    .optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  priority: z.enum([...TICKET_PRIORITIES, "unclassified"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const CreateBody = z.object({
  bookId: z.string().min(1).max(20).nullable().default(null), // null = "General / Account level"
  subject: z.string().trim().min(5, "Subject must be at least 5 characters").max(150),
  description: z.string().trim().min(20, "Please describe the issue in at least 20 characters").max(5000),
});

const UpdateBody = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    category: z.enum(TICKET_CATEGORIES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    assigneeId: z.number().int().positive().nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Provide at least one field to update");

const MessageBody = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(5000),
  internal: z.boolean().default(false), // true = internal note, never shown to the author
});

// Authors get their own tickets; admins get the full queue (with filters).
ticketsRouter.get("/", async (req, res) => {
  const { status, ...filters } = parseQuery(ListQuery, req);
  res.json({ data: await service.listTickets(req.user!, { ...filters, statuses: status }) });
});

ticketsRouter.post("/", requireRole("author"), async (req, res) => {
  const ticket = await service.createTicket(req.user!, parseBody(CreateBody, req));
  res.status(201).json({ data: ticket });
});

ticketsRouter.get("/:id", async (req, res) => {
  const { id } = parseParams(IdParams, req);
  res.json({ data: await service.getTicketDetail(req.user!, id) });
});

ticketsRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const { id } = parseParams(IdParams, req);
  res.json({ data: await service.updateTicket(req.user!, id, parseBody(UpdateBody, req)) });
});

// Admins reply or add internal notes; authors add follow-ups to their own tickets (`internal` is ignored for them).
ticketsRouter.post("/:id/messages", async (req, res) => {
  const { id } = parseParams(IdParams, req);
  const input = parseBody(MessageBody, req);
  const ticket =
    req.user!.role === "admin"
      ? await service.addStaffMessage(req.user!, id, input)
      : await service.addAuthorMessage(req.user!, id, input.body);
  res.status(201).json({ data: ticket });
});

// AI draft: GET returns the saved draft (generating it the first time), POST generates a new one.
ticketsRouter.get("/:id/draft", requireRole("admin"), async (req, res) => {
  const { id } = parseParams(IdParams, req);
  res.json({ data: await service.getOrCreateDraft(req.user!, id, false) });
});

ticketsRouter.post("/:id/draft", requireRole("admin"), async (req, res) => {
  const { id } = parseParams(IdParams, req);
  res.json({ data: await service.getOrCreateDraft(req.user!, id, true) });
});

ticketsRouter.post("/:id/classify", requireRole("admin"), async (req, res) => {
  const { id } = parseParams(IdParams, req);
  res.json({ data: await service.retryClassification(req.user!, id) });
});
