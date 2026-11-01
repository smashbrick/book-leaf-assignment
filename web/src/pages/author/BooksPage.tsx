import { Link } from "react-router-dom";
import { useBooks } from "../../api/hooks";
import type { Book } from "../../api/types";
import { EmptyState, ErrorBox, Loading } from "../../components/ui";
import { formatDate, inr } from "../../lib/format";

const isPublished = (b: Book) => b.publicationDate !== null;

export function BooksPage() {
  const { data, isPending, error } = useBooks();
  if (isPending) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const { data: books, royalty } = data;
  const totals = books.reduce(
    (t, b) => ({ earned: t.earned + b.totalRoyaltyEarned, paid: t.paid + b.royaltyPaid, sold: t.sold + b.totalCopiesSold }),
    { earned: 0, paid: 0, sold: 0 },
  );

  return (
    <>
      <div className="page-head">
        <h1>My books</h1>
        <Link to="/tickets/new" className="btn btn-primary">Get help</Link>
      </div>

      {books.length === 0 ? (
        <EmptyState title="No books yet">Once your manuscript is received, it will appear here.</EmptyState>
      ) : (
        <>
          <section className="stats">
            <div className="stat"><span>Copies sold</span><strong>{totals.sold.toLocaleString("en-IN")}</strong></div>
            <div className="stat"><span>Royalty earned</span><strong>{inr(totals.earned)}</strong></div>
            <div className="stat"><span>Royalty paid</span><strong>{inr(totals.paid)}</strong></div>
            <div className="stat"><span>Royalty pending</span><strong>{inr(royalty.totalPending)}</strong></div>
          </section>

          {/* Answer the most common royalty question ("when do I get paid?") before it becomes a ticket. */}
          <div className="alert alert-info">
            {royalty.totalPending === 0
              ? "You have no pending royalty right now. Royalties are calculated quarterly and paid within 45 days of each quarter ending."
              : royalty.meetsThreshold
                ? `Your pending balance of ${inr(royalty.totalPending)} is above the ${inr(royalty.threshold)} payout threshold. The next payout is due by ${formatDate(royalty.nextPayoutBy)}.`
                : `Your pending balance of ${inr(royalty.totalPending)} is below the ${inr(royalty.threshold)} minimum payout, so it rolls over to the next quarter.`}
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>ISBN</th>
                  <th>Genre</th>
                  <th>Published</th>
                  <th>Status</th>
                  <th className="num">MRP</th>
                  <th className="num">Copies sold</th>
                  <th className="num">Earned</th>
                  <th className="num">Paid</th>
                  <th className="num">Pending</th>
                </tr>
              </thead>
              <tbody>
                {books.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.title}</strong>
                      <div><Link to={`/tickets/new?bookId=${b.id}`} className="small">Ask about this book</Link></div>
                    </td>
                    <td className="mono">{b.isbn ?? "—"}</td>
                    <td>{b.genre ?? "—"}</td>
                    <td>{isPublished(b) ? formatDate(b.publicationDate) : <span className="muted">Not yet</span>}</td>
                    <td>
                      <span className={`badge ${isPublished(b) ? "status-resolved" : "status-in_progress"}`}>{b.status}</span>
                    </td>
                    <td className="num">{inr(b.mrp)}</td>
                    <td className="num">{isPublished(b) ? b.totalCopiesSold.toLocaleString("en-IN") : "—"}</td>
                    <td className="num">{isPublished(b) ? inr(b.totalRoyaltyEarned) : "—"}</td>
                    <td className="num">{isPublished(b) ? inr(b.royaltyPaid) : "—"}</td>
                    <td className="num">{isPublished(b) ? inr(b.royaltyPending) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Books still in production show sales and royalty figures once they're published and live.
          </p>
        </>
      )}
    </>
  );
}
