import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuthorTicket, useSendMessage } from "../../api/hooks";
import type { AuthorTicketDetail } from "../../api/types";
import { CategoryLabel, ErrorBox, Loading, StatusBadge, Thread } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

export function AuthorTicketPage() {
  const id = Number(useParams().id);
  const { data: ticket, isPending, error } = useAuthorTicket(id);

  if (isPending) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const waitingForUs = ticket.messages.at(-1)?.kind === "author" && ticket.status !== "closed";

  return (
    <>
      <Link to="/tickets" className="muted small">← My tickets</Link>
      <div className="page-head">
        <div>
          <h1>{ticket.subject}</h1>
          <div className="muted small">
            #{ticket.id} · {ticket.bookTitle ?? "General / Account"} · <CategoryLabel category={ticket.category} /> · opened{" "}
            {formatDateTime(ticket.createdAt)}
          </div>
        </div>
        <StatusBadge status={ticket.status} />
      </div>

      <Thread messages={ticket.messages} viewerRole="author" />

      {waitingForUs && (
        <p className="muted small">Our team has your message. This page updates automatically when we reply.</p>
      )}

      {ticket.status === "closed" ? (
        <p className="muted small">
          This ticket is closed. Need more help? <Link to="/tickets/new">Raise a new ticket</Link>.
        </p>
      ) : (
        <FollowUpBox key={ticket.id} ticket={ticket} />
      )}
    </>
  );
}

/** Lets the author answer a question from the team or add details. Replying to a resolved ticket reopens it. */
function FollowUpBox({ ticket }: { ticket: AuthorTicketDetail }) {
  const [text, setText] = useState("");
  const send = useSendMessage(ticket.id);

  async function submit() {
    await send.mutateAsync({ body: text });
    setText("");
  }

  return (
    <div className="card composer">
      <ErrorBox error={send.error} />
      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000}
        placeholder="Add more details or reply to our team…" />
      <div className="actions">
        {ticket.status === "resolved" && <span className="muted small">Sending a message will reopen this ticket.</span>}
        <button className="btn btn-primary" disabled={!text.trim() || send.isPending} onClick={submit}>
          {send.isPending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
