import { Router } from "express";
import { z } from "zod";
import { parseBody, parseParams, parseQuery } from "../../lib/validate.js";
import { requireRole } from "../../middleware/auth.js";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "./ticket.constants.js";
import * as service from "./tickets.service.js";

export const ticketsRouter = Router();

const IdParams = z.object({ id: z.coerce.number().int().positive("Ticket id must be a positive integer") });

// Accepts ?status=open,in_progress or repeated ?status=open&status=in_progress
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(",")).filter(Boolean))
    .pipe(z.array(z.enum(values)));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const ListQuery = z.object({
  status: csvEnum(TICKET_STATUSES).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  priority: z.enum([...TICKET_PRIORITIES, "unclassified"]).optional(),
  assignee: z.enum(["me", "unassigned"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["urgency", "newest", "oldest"]).default("urgency"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const CreateBody = z.object({
  bookId: z.string().max(20).nullable().default(null), // null = "General / Account level"
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
  // Staff-only fields. Ignored for authors (see service).
  internal: z.boolean().optional(),
  usedAiDraft: z.boolean().optional(),
  setStatus: z.enum(TICKET_STATUSES).optional(),
});

// GET /tickets: authors see their own, admins see the whole queue (with filters)
ticketsRouter.get("/", async (req, res) => {
  const { page, pageSize, ...filters } = parseQuery(ListQuery, req);
  const result = await service.listTickets(req.user!, {
    ...filters,
    statuses: filters.status,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  res.json({ ...result, page, pageSize });
});

// POST /tickets: authors raise a ticket
ticketsRouter.post("/", requireRole("author"), async (req, res) => {
  const ticket = await service.createTicket(req.user!, parseBody(CreateBody, req));
  res.status(201).location(`/api/v1/tickets/${ticket.id}`).json({ data: ticket });
});

ticketsRouter.get("/:id", async (req, res) => {
  const { id } = parseParams(IdParams, req);
  res.json({ data: await service.getTicketDetail(req.user!, id) });
});

// PATCH /tickets/:id: admins change status, override category/priority, assign
ticketsRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const { id } = parseParams(IdParams, req);
  res.json({ data: await service.updateTicket(req.user!, id, parseBody(UpdateBody, req)) });
});

// POST /tickets/:id/messages: author follow-up, admin reply, or admin internal note
ticketsRouter.post("/:id/messages", async (req, res) => {
  const { id } = parseParams(IdParams, req);
  const body = parseBody(MessageBody, req);
  const input = req.user!.role === "admin" ? body : { body: body.body };
  res.status(201).json({ data: await service.addMessage(req.user!, id, input) });
});

// GET /tickets/:id/draft: AI draft (cached). POST regenerates it.
ticketsRouter.get("/:id/draft", requireRole("admin"), async (req, res) => {
  const { id } = parseParams(IdParams, req);
  res.json({ data: await service.getOrCreateDraft(req.user!, id, { regenerate: false }) });
});

ticketsRouter.post("/:id/draft", requireRole("admin"), async (req, res) => {
  const { id } = parseParams(IdParams, req);
  res.status(201).json({ data: await service.getOrCreateDraft(req.user!, id, { regenerate: true }) });
});

// POST /tickets/:id/classification: re-run AI classification after a failure
ticketsRouter.post("/:id/classification", requireRole("admin"), async (req, res) => {
  const { id } = parseParams(IdParams, req);
  res.status(202).json({ data: await service.retryClassification(req.user!, id) });
});
