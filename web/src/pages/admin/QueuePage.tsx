import { Link, useSearchParams } from "react-router-dom";
import { type QueueFilters, useQueue } from "../../api/hooks";
import { EmptyState, ErrorBox, Loading, PriorityBadge, StatusBadge } from "../../components/ui";
import { age, CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS } from "../../lib/format";

export function QueuePage() {
  // Filters are kept in the URL so the view survives a refresh.
  const [params, setParams] = useSearchParams();
  const filters: QueueFilters = {
    status: params.get("status") ?? "open,in_progress", // default: tickets that still need work
    category: params.get("category") ?? undefined,
    priority: params.get("priority") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  };
  const { data: tickets, isPending, error } = useQueue(filters);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <>
      <div className="page-head">
        <h1>Ticket queue</h1>
        <span className="muted small">Most urgent first, then oldest</span>
      </div>

      <div className="filters card">
        <select value={filters.status} onChange={(e) => setFilter("status", e.target.value)} aria-label="Status">
          <option value="open,in_progress">Open + In progress</option>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filters.category ?? ""} onChange={(e) => setFilter("category", e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filters.priority ?? ""} onChange={(e) => setFilter("priority", e.target.value)} aria-label="Priority">
          <option value="">All priorities</option>
          {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          <option value="unclassified">Unclassified</option>
        </select>
        <label className="inline">From <input type="date" value={filters.from ?? ""} onChange={(e) => setFilter("from", e.target.value)} /></label>
        <label className="inline">To <input type="date" value={filters.to ?? ""} onChange={(e) => setFilter("to", e.target.value)} /></label>
        {params.toString() && <button className="btn btn-ghost" onClick={() => setParams({})}>Reset</button>}
      </div>

      <ErrorBox error={error} />
      {isPending ? (
        <Loading />
      ) : !tickets?.length ? (
        <EmptyState title="No tickets match these filters" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Priority</th>
                <th>Ticket</th>
                <th>Category</th>
                <th>Status</th>
                <th>Assigned to</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td>
                    <PriorityBadge priority={t.priority} />
                    {t.aiStatus === "pending" && <div className="muted small">AI triaging…</div>}
                  </td>
                  <td>
                    <Link to={`/admin/tickets/${t.id}`}><strong>{t.subject}</strong></Link>
                    <div className="muted small">#{t.id} · {t.authorName} · {t.bookTitle ?? "General / Account"}</div>
                  </td>
                  <td>{t.category ? CATEGORY_LABELS[t.category] : <span className="muted">—</span>}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>{t.assigneeName ?? <span className="muted">—</span>}</td>
                  <td title={new Date(t.createdAt).toLocaleString()}>{age(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
