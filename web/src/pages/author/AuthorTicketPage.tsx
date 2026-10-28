import { Link, useParams } from "react-router-dom";
import { useAuthorTicket } from "../../api/hooks";
import { CategoryLabel, ErrorBox, Loading, StatusBadge, Thread } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

export function AuthorTicketPage() {
  const id = Number(useParams().id);
  const { data: ticket, isPending, error } = useAuthorTicket(id);

  if (isPending) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const waitingForReply = !ticket.messages.some((m) => m.kind === "reply");

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

      {waitingForReply && (
        <p className="muted small">Our team has your query. This page updates automatically when we reply.</p>
      )}
    </>
  );
}
