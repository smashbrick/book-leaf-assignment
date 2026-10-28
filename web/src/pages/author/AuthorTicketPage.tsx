import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuthorTicket, useSendMessage } from "../../api/hooks";
import { CategoryLabel, ErrorBox, Loading, StatusBadge, Thread } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

export function AuthorTicketPage() {
  const id = Number(useParams().id);
  const { data: ticket, isPending, error } = useAuthorTicket(id);
  const send = useSendMessage(id);
  const [body, setBody] = useState("");

  if (isPending) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    await send.mutateAsync({ body });
    setBody("");
  }

  const awaitingReply = ticket.messages.at(-1)?.kind === "author" && ticket.status !== "closed";

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

      {awaitingReply && (
        <p className="muted small">Our team has your message. This page updates automatically when we reply.</p>
      )}

      {ticket.status === "closed" ? (
        <div className="alert alert-info">
          This ticket is closed. Need more help? <Link to="/tickets/new">Open a new ticket</Link>.
        </div>
      ) : (
        <form className="card form" onSubmit={submit}>
          <ErrorBox error={send.error} />
          <label>
            {ticket.status === "resolved" ? "Still need help? Replying will reopen this ticket." : "Add a reply"}
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={5000} required />
          </label>
          <div className="actions">
            <button className="btn btn-primary" disabled={send.isPending || !body.trim()}>
              {send.isPending ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
