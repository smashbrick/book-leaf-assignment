import { Link } from "react-router-dom";
import { useMyTickets } from "../../api/hooks";
import { CategoryLabel, EmptyState, ErrorBox, Loading, StatusBadge } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

export function MyTicketsPage() {
  const { data, isPending, error } = useMyTickets();
  if (isPending) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <>
      <div className="page-head">
        <h1>My tickets</h1>
        <Link to="/tickets/new" className="btn btn-primary">New ticket</Link>
      </div>
      {data.length === 0 ? (
        <EmptyState title="No tickets yet">
          Questions about royalties, ISBNs, printing or your book's status? <Link to="/tickets/new">Raise a ticket</Link> and we'll get back to you.
        </EmptyState>
      ) : (
        <ul className="ticket-list">
          {data.map((t) => (
            <li key={t.id}>
              <Link to={`/tickets/${t.id}`} className="card ticket-row">
                <div>
                  <strong>{t.subject}</strong>
                  <div className="muted small">
                    #{t.id} · {t.bookTitle ?? "General / Account"} · <CategoryLabel category={t.category} />
                  </div>
                </div>
                <div className="ticket-row-right">
                  <StatusBadge status={t.status} />
                  <span className="muted small">Updated {formatDateTime(t.updatedAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
