import type { ReactNode } from "react";
import { ApiError } from "../api/client";
import type { Message, TicketCategory, TicketPriority, TicketStatus } from "../api/types";
import { CATEGORY_LABELS, formatDateTime, PRIORITY_LABELS, STATUS_LABELS } from "../lib/format";

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: TicketPriority | null }) {
  if (!priority) return <span className="badge priority-none" title="Not classified yet">Unclassified</span>;
  return <span className={`badge priority-${priority}`}>{PRIORITY_LABELS[priority]}</span>;
}

export function CategoryLabel({ category }: { category: TicketCategory | null }) {
  return <span className="muted">{category ? CATEGORY_LABELS[category] : "Awaiting triage"}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : "Something went wrong";
  const details = error instanceof ApiError ? error.details : undefined;
  return (
    <div className="alert alert-error" role="alert">
      {message}
      {details && (
        <ul>
          {details.map((d) => (
            <li key={d.path + d.message}>{d.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const Loading = ({ label = "Loading…" }: { label?: string }) => <div className="muted loading">{label}</div>;

/** The ticket conversation. Internal notes only reach this component on the admin side. */
export function Thread({ messages, viewerRole }: { messages: Message[]; viewerRole: "author" | "admin" }) {
  return (
    <ol className="thread">
      {messages.map((m) => {
        const fromAuthor = m.kind === "author";
        const who = fromAuthor ? (viewerRole === "author" ? "You" : m.senderName) : `${m.senderName} · BookLeaf Support`;
        return (
          <li key={m.id} className={`msg msg-${m.kind}`}>
            <div className="msg-meta">
              <strong>{who}</strong>
              {m.kind === "internal_note" && <span className="badge badge-note">Internal note</span>}
              {viewerRole === "admin" && m.usedAiDraft && <span className="badge badge-ai" title="Sent from an AI draft">AI-assisted</span>}
              <span className="muted">{formatDateTime(m.createdAt)}</span>
            </div>
            <div className="msg-body">{m.body}</div>
          </li>
        );
      })}
    </ol>
  );
}
