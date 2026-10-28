// Response shapes from the REST API (documented in the README).

export type Role = "author" | "admin";
export interface User {
  id: number;
  role: Role;
  name: string;
  authorId: string | null;
}

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketCategory =
  | "royalty_payments"
  | "isbn_metadata"
  | "printing_quality"
  | "distribution_availability"
  | "book_status_production"
  | "general_inquiry";
export type TicketPriority = "critical" | "high" | "medium" | "low";

export interface Book {
  id: string;
  authorId: string;
  title: string;
  isbn: string | null;
  genre: string | null;
  publicationDate: string | null;
  status: string;
  mrp: number | null;
  authorRoyaltyPerCopy: number | null;
  totalCopiesSold: number;
  totalRoyaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  lastRoyaltyPayoutDate: string | null;
  printPartner: string | null;
  availableOn: string[];
}

export interface RoyaltySummary {
  totalPending: number;
  threshold: number;
  meetsThreshold: boolean;
  nextPayoutBy: string;
  lastPayoutDate: string | null;
}

export interface Message {
  id: number;
  senderName: string;
  kind: "author" | "reply" | "internal_note";
  body: string;
  createdAt: string;
}

/** Fields both roles see. */
export interface TicketBase {
  id: number;
  subject: string;
  description: string;
  status: TicketStatus;
  category: TicketCategory | null;
  bookId: string | null;
  bookTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Extra fields only admins receive. */
export interface StaffTicket extends TicketBase {
  authorId: string;
  authorName: string;
  priority: TicketPriority | null;
  aiCategory: TicketCategory | null;
  aiPriority: TicketPriority | null;
  aiReasoning: string | null;
  aiStatus: "pending" | "done" | "failed";
  aiError: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
}

export interface AuthorTicketDetail extends TicketBase {
  messages: Message[];
}

export interface StaffTicketDetail extends StaffTicket {
  messages: Message[];
  book: Book | null;
  royalty: RoyaltySummary;
}

export interface Draft {
  body: string;
}
