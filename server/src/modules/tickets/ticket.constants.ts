// Single source of truth for ticket enums. These must match the Postgres ENUM types in 001_init.sql.

export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_CATEGORIES = [
  "royalty_payments",
  "isbn_metadata",
  "printing_quality",
  "distribution_availability",
  "book_status_production",
  "general_inquiry",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  royalty_payments: "Royalty & Payments",
  isbn_metadata: "ISBN & Metadata Issues",
  printing_quality: "Printing & Quality",
  distribution_availability: "Distribution & Availability",
  book_status_production: "Book Status & Production Updates",
  general_inquiry: "General Inquiry",
};

export const TICKET_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/**
 * How long a ticket may wait for a first response before it's flagged as overdue in the queue.
 * These are our own defaults. The assignment doesn't specify SLAs.
 */
export const FIRST_RESPONSE_SLA_HOURS: Record<TicketPriority, number> = {
  critical: 4,
  high: 24,
  medium: 48,
  low: 72,
};
