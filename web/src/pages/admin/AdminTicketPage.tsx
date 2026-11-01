import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { keys, useDraft, useRegenerateDraft, useRetryClassification, useSendMessage, useStaffTicket, useUpdateTicket } from "../../api/hooks";
import type { StaffTicketDetail, TicketCategory, TicketPriority, TicketStatus } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { ErrorBox, Loading, PriorityBadge, StatusBadge, Thread } from "../../components/ui";
import { age, CATEGORY_LABELS, formatDate, formatDateTime, inr, PRIORITY_LABELS, STATUS_LABELS } from "../../lib/format";

export function AdminTicketPage() {
  const id = Number(useParams().id);
  const { data: ticket, isPending, error } = useStaffTicket(id);
  if (isPending) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <>
      <Link to="/admin/tickets" className="muted small">← Queue</Link>
      <div className="page-head">
        <div>
          <h1>{ticket.subject}</h1>
          <div className="muted small">
            #{ticket.id} · {ticket.authorName} · {ticket.bookTitle ?? "General / Account"} · opened {formatDateTime(ticket.createdAt)} ({age(ticket.createdAt)} ago)
          </div>
        </div>
        <div className="row">
          <PriorityBadge priority={ticket.priority} />
          <StatusBadge status={ticket.status} />
        </div>
      </div>

      <div className="two-col">
        <div>
          <Thread messages={ticket.messages} viewerRole="admin" />
          {/* key resets the editor when moving to another ticket */}
          <ReplyBox key={ticket.id} ticket={ticket} />
        </div>
        <aside>
          <TicketDetails ticket={ticket} />
          <AuthorInfo ticket={ticket} />
        </aside>
      </div>
    </>
  );
}

/** Reply editor, pre-filled with the AI draft. Nothing is sent until the admin clicks Send. */
function ReplyBox({ ticket }: { ticket: StaffTicketDetail }) {
  const [internal, setInternal] = useState(false);
  const [text, setText] = useState("");
  const qc = useQueryClient();
  const send = useSendMessage(ticket.id);
  // Only ask for a draft while the author is waiting on us: their message is the latest one the author can see.
  const lastVisible = ticket.messages.filter((m) => m.kind !== "internal_note").at(-1);
  const needsReply = lastVisible?.kind === "author" && ticket.status !== "closed";
  const draft = useDraft(ticket.id, needsReply);
  const regenerate = useRegenerateDraft(ticket.id);

  // Put the draft in the editor when it arrives, unless the admin has already started typing.
  useEffect(() => {
    if (draft.data && !text) setText(draft.data.body);
  }, [draft.data]);

  const aiError = draft.error ?? regenerate.error;

  async function submit() {
    await send.mutateAsync({ body: text, internal });
    setText("");
    qc.removeQueries({ queryKey: keys.draft(ticket.id) }); // the server deletes the used draft too
  }

  return (
    <div className="card composer">
      <div className="tabs">
        <button className={!internal ? "active" : ""} onClick={() => setInternal(false)}>Reply to author</button>
        <button className={internal ? "active" : ""} onClick={() => setInternal(true)}>Internal note</button>
      </div>
      <ErrorBox error={send.error} />

      {!internal && (
        <div className="draft-bar">
          {draft.isFetching || regenerate.isPending ? (
            <span className="muted">✨ Writing a draft from the knowledge base…</span>
          ) : aiError ? (
            <span className="warn">
              {aiError instanceof ApiError && aiError.code === "AI_UNAVAILABLE" ? aiError.message : "Couldn't load the AI draft."}
            </span>
          ) : draft.data ? (
            <span className="muted">✨ AI draft. Check and edit before sending.</span>
          ) : null}
          <button className="btn btn-ghost" disabled={regenerate.isPending}
            onClick={async () => setText((await regenerate.mutateAsync()).body)}>
            {draft.data ? "Regenerate" : "Generate AI draft"}
          </button>
        </div>
      )}
      {internal && <p className="muted small">Only BookLeaf staff can see internal notes.</p>}

      <textarea rows={internal ? 4 : 12} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={internal ? "e.g. Checked with finance: bank details are missing" : "Write a reply to the author…"} />
      <div className="actions">
        <button className="btn btn-primary" disabled={!text.trim() || send.isPending} onClick={submit}>
          {send.isPending ? "Sending…" : internal ? "Add note" : "Send reply"}
        </button>
      </div>
    </div>
  );
}

function TicketDetails({ ticket }: { ticket: StaffTicketDetail }) {
  const { user } = useAuth();
  const update = useUpdateTicket(ticket.id);
  const retry = useRetryClassification(ticket.id);

  return (
    <div className="card panel">
      <h3>Ticket</h3>
      <ErrorBox error={update.error ?? retry.error} />

      <label>
        Status
        <select value={ticket.status} onChange={(e) => update.mutate({ status: e.target.value as TicketStatus })}>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>

      <label>
        Category
        <select value={ticket.category ?? ""} onChange={(e) => update.mutate({ category: e.target.value as TicketCategory })}>
          {!ticket.category && <option value="">Choose…</option>}
          {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {ticket.aiCategory && ticket.category !== ticket.aiCategory && (
          <span className="muted small">AI suggested: {CATEGORY_LABELS[ticket.aiCategory]}</span>
        )}
      </label>

      <label>
        Priority
        <select value={ticket.priority ?? ""} onChange={(e) => update.mutate({ priority: e.target.value as TicketPriority })}>
          {!ticket.priority && <option value="">Choose…</option>}
          {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {ticket.aiPriority && ticket.priority !== ticket.aiPriority && (
          <span className="muted small">AI suggested: {PRIORITY_LABELS[ticket.aiPriority]}</span>
        )}
      </label>
      {ticket.aiReasoning && <p className="ai-reason">✨ {ticket.aiReasoning}</p>}
      {ticket.aiStatus === "pending" && <p className="muted small">AI is classifying this ticket…</p>}
      {ticket.aiStatus === "failed" && (
        <div className="alert alert-warn small">
          AI classification failed ({ticket.aiError}). Set the category and priority yourself, or{" "}
          <button className="btn btn-link" onClick={() => retry.mutate()} disabled={retry.isPending}>try again</button>.
        </div>
      )}

      <div>
        <div className="small muted">Assigned to</div>
        <div className="row">
          <span>{ticket.assigneeName ?? "Nobody"}</span>
          {ticket.assigneeId === user?.id ? (
            <button className="btn btn-link" onClick={() => update.mutate({ assigneeId: null })}>Unassign</button>
          ) : (
            <button className="btn btn-link" onClick={() => update.mutate({ assigneeId: user!.id })}>Assign to me</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The author's book and royalty numbers, so the admin doesn't have to look them up. */
function AuthorInfo({ ticket }: { ticket: StaffTicketDetail }) {
  const { book, royalty } = ticket;
  return (
    <div className="card panel">
      <h3>Author &amp; book</h3>
      {book ? (
        <dl>
          <dt>Book</dt><dd>{book.title}</dd>
          <dt>Status</dt><dd>{book.status}</dd>
          <dt>ISBN</dt><dd className="mono">{book.isbn ?? "—"}</dd>
          <dt>Published</dt><dd>{formatDate(book.publicationDate)}</dd>
          <dt>Copies sold</dt><dd>{book.totalCopiesSold.toLocaleString("en-IN")}</dd>
          <dt>Royalty paid</dt><dd>{inr(book.royaltyPaid)}</dd>
          <dt>Royalty pending</dt><dd>{inr(book.royaltyPending)}</dd>
          <dt>Last payout</dt><dd>{formatDate(book.lastRoyaltyPayoutDate)}</dd>
          <dt>Available on</dt><dd>{book.availableOn.length ? book.availableOn.join(", ") : "Not listed yet"}</dd>
        </dl>
      ) : (
        <p className="muted small">General / account-level ticket.</p>
      )}
      <h4>All books</h4>
      <dl>
        <dt>Total pending</dt><dd>{inr(royalty.totalPending)}{!royalty.meetsThreshold && ` (below ${inr(royalty.threshold)} minimum)`}</dd>
        <dt>Next payout by</dt><dd>{formatDate(royalty.nextPayoutBy)}</dd>
      </dl>
    </div>
  );
}
