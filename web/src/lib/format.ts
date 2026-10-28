import type { TicketCategory, TicketPriority, TicketStatus } from "../api/types";

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  royalty_payments: "Royalty & Payments",
  isbn_metadata: "ISBN & Metadata",
  printing_quality: "Printing & Quality",
  distribution_availability: "Distribution & Availability",
  book_status_production: "Book Status & Production",
  general_inquiry: "General Inquiry",
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const inr = (n: number | null | undefined) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** "5m", "3h", "2d": how long ago. */
export function age(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
