import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import {
  keys,
  useDraft, useRegenerateDraft, useRetryClassification, useSendMessage, useStaff, useStaffTicket, useUpdateTicket,
} from "../../api/hooks";
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
            #{ticket.id} · {ticket.authorName} ({ticket.authorId}) · {ticket.bookTitle ?? "General / Account"} · opened{" "}
            {formatDateTime(ticket.createdAt)} ({age(ticket.createdAt)} ago)
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
          {/* key: reset the editor when navigating between tickets */}
          <Composer key={ticket.id} ticket={ticket} />
        </div>
        <aside>
          <TriagePanel ticket={ticket} />
          <ContextPanel ticket={ticket} />
        </aside>
      </div>
    </>
  );
}

/** Reply/notes editor, pre-filled with the AI draft. Nothing is sent without a human pressing Send. */
function Composer({ ticket }: { ticket: StaffTicketDetail }) {
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [fromDraft, setFromDraft] = useState(false);
  const closed = ticket.status === "closed";
  // Only request a draft when a reply is actually needed: the author spoke last and the ticket is active.
  const needsReply = ticket.messages.filter((m) => m.kind !== "internal_note").at(-1)?.kind === "author" && !closed;
  const draft = useDraft(ticket.id, needsReply);
  const regenerate = useRegenerateDraft(ticket.id);
  const send = useSendMessage(ticket.id);
  const qc = useQueryClient();

  // Fill the editor with the draft once it arrives, but never overwrite what the admin has typed.
  useEffect(() => {
    if (draft.data && !text) {
      setText(draft.data.body);
      setFromDraft(true);
    }
  }, [draft.data]);

  const aiError = draft.error ?? regenerate.error;
  const aiUnavailable = aiError instanceof ApiError && aiError.code === "AI_UNAVAILABLE";

  async function sendReply(setStatus?: TicketStatus) {
    await send.mutateAsync({ body: text, usedAiDraft: fromDraft, setStatus });
    setText("");
    setFromDraft(false);
    // The server discards the draft once a reply is sent. Drop ours too, so the author's next message gets a fresh one.
    qc.removeQueries({ queryKey: keys.draft(ticket.id) });
  }

  return (
    <div className="card composer">
      <div className="tabs">
        <button className={mode === "reply" ? "active" : ""} onClick={() => setMode("reply")}>Reply to author</button>
        <button className={mode === "note" ? "active" : ""} onClick={() => setMode("note")}>Internal note</button>
      </div>
      <ErrorBox error={send.error} />

      {mode === "reply" ? (
        closed ? (
          <p className="muted">This ticket is closed. Reopen it from the status menu to reply.</p>
        ) : (
          <>
            <div className="draft-bar">
              {draft.isFetching || regenerate.isPending ? (
                <span className="muted">✨ Drafting a reply from the knowledge base…</span>
              ) : aiError ? (
                <span className={aiUnavailable ? "warn" : "error"}>{aiError.message}</span>
              ) : fromDraft ? (
                <span className="muted">✨ AI draft: review and edit before sending.</span>
              ) : !needsReply ? (
                <span className="muted">The author hasn't written since the last reply.</span>
              ) : null}
              <button className="btn btn-ghost" disabled={regenerate.isPending}
                onClick={async () => {
                  const d = await regenerate.mutateAsync();
                  setText(d.body);
                  setFromDraft(true);
                }}>
                {draft.data || aiError ? "Regenerate draft" : "Generate AI draft"}
              </button>
            </div>
            <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply to the author…" />
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => { setText(""); setFromDraft(false); }} disabled={!text}>Clear</button>
              <button className="btn" disabled={!text.trim() || send.isPending} onClick={() => sendReply("resolved")}>Send &amp; resolve</button>
              <button className="btn btn-primary" disabled={!text.trim() || send.isPending} onClick={() => sendReply()}>
                {send.isPending ? "Sending…" : "Send reply"}
              </button>
            </div>
          </>
        )
      ) : (
        <>
          <p className="muted small">Visible to BookLeaf staff only. Never shown to the author.</p>
          <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Checked finance: bank details missing" />
          <div className="actions">
            <button className="btn btn-primary" disabled={!note.trim() || send.isPending}
              onClick={async () => {
                await send.mutateAsync({ body: note, internal: true });
                setNote("");
              }}>
              Add note
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TriagePanel({ ticket }: { ticket: StaffTicketDetail }) {
  const { user } = useAuth();
  const update = useUpdateTicket(ticket.id);
  const retry = useRetryClassification(ticket.id);
  const staff = useStaff();

  return (
    <div className="card panel">
      <h3>Triage</h3>
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
        {ticket.aiCategory && (
          <span className="muted small">
            AI suggested: {CATEGORY_LABELS[ticket.aiCategory]}
            {ticket.category !== ticket.aiCategory && " (overridden)"}
          </span>
        )}
      </label>

      <label>
        Priority
        <select value={ticket.priority ?? ""} onChange={(e) => update.mutate({ priority: e.target.value as TicketPriority })}>
          {!ticket.priority && <option value="">Choose…</option>}
          {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {ticket.aiPriority && (
          <span className="muted small">
            AI suggested: {PRIORITY_LABELS[ticket.aiPriority]}
            {ticket.priority !== ticket.aiPriority && " (overridden)"}
          </span>
        )}
      </label>
      {ticket.aiReasoning && <p className="ai-reason">✨ {ticket.aiReasoning}</p>}

      {ticket.aiStatus === "pending" && <p className="muted small">AI is classifying this ticket…</p>}
      {ticket.aiStatus === "failed" && (
        <div className="alert alert-warn small">
          AI classification failed: {ticket.aiError}. Set category and priority manually, or{" "}
          <button className="btn btn-link" onClick={() => retry.mutate()} disabled={retry.isPending}>retry AI</button>.
        </div>
      )}

      <label>
        Assignee
        <select
          value={ticket.assigneeId ?? ""}
          onChange={(e) => update.mutate({ assigneeId: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Unassigned</option>
          {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {ticket.assigneeId !== user?.id && (
        <button className="btn" onClick={() => update.mutate({ assigneeId: user!.id })}>Assign to me</button>
      )}
      <p className="muted small">
        First-reply target for this priority: {ticket.slaHours}h.{" "}
        {ticket.firstResponseAt ? `First replied ${formatDateTime(ticket.firstResponseAt)}.` : ticket.firstResponseOverdue ? <strong className="overdue">Overdue.</strong> : ""}
      </p>
    </div>
  );
}

/** The author's book and royalty facts, so the agent can answer without looking anything up. */
function ContextPanel({ ticket }: { ticket: StaffTicketDetail }) {
  const { book, royalty } = ticket;
  return (
    <div className="card panel">
      <h3>Author context</h3>
      {book ? (
        <dl>
          <dt>Book</dt><dd>{book.title}</dd>
          <dt>Status</dt><dd>{book.status}</dd>
          <dt>ISBN</dt><dd className="mono">{book.isbn ?? "—"}</dd>
          <dt>Published</dt><dd>{formatDate(book.publicationDate)}</dd>
          <dt>MRP</dt><dd>{inr(book.mrp)}</dd>
          <dt>Copies sold</dt><dd>{book.totalCopiesSold.toLocaleString("en-IN")}</dd>
          <dt>Royalty earned</dt><dd>{inr(book.totalRoyaltyEarned)}</dd>
          <dt>Paid / pending</dt><dd>{inr(book.royaltyPaid)} / {inr(book.royaltyPending)}</dd>
          <dt>Last payout</dt><dd>{formatDate(book.lastRoyaltyPayoutDate)}</dd>
          <dt>Print partner</dt><dd>{book.printPartner ?? "—"}</dd>
          <dt>Available on</dt><dd>{book.availableOn.length ? book.availableOn.join(", ") : "Not listed yet"}</dd>
        </dl>
      ) : (
        <p className="muted small">Account-level ticket (no specific book).</p>
      )}
      <h4>Royalty (all books)</h4>
      <dl>
        <dt>Total pending</dt><dd>{inr(royalty.totalPending)} {royalty.meetsThreshold ? "" : `(below ${inr(royalty.threshold)} threshold)`}</dd>
        <dt>Next payout by</dt><dd>{formatDate(royalty.nextPayoutBy)}</dd>
        <dt>Last payout</dt><dd>{formatDate(royalty.lastPayoutDate)}</dd>
      </dl>
      {royalty.possiblyOverdue && (
        <div className="alert alert-warn small">
          Possibly overdue: the {formatDate(royalty.lastPassedDeadline)} payout deadline passed with an eligible balance and no payout since.
        </div>
      )}
    </div>
  );
}
