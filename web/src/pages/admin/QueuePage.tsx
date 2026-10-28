import { Link, useSearchParams } from "react-router-dom";
import { type QueueFilters, useQueue, useStats } from "../../api/hooks";
import { EmptyState, ErrorBox, Loading, PriorityBadge, StatusBadge } from "../../components/ui";
import { age, CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS } from "../../lib/format";

// Default view is what an agent should work on: active tickets, most urgent and oldest first.
const DEFAULT_STATUS = "open,in_progress";

export function QueuePage() {
  // Filters live in the URL, so a filtered view survives refresh and can be shared with a teammate.
  const [params, setParams] = useSearchParams();
  const filters: QueueFilters = {
    status: params.get("status") ?? DEFAULT_STATUS,
    category: params.get("category") ?? undefined,
    priority: params.get("priority") ?? undefined,
    assignee: params.get("assignee") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    q: params.get("q") ?? undefined,
    sort: params.get("sort") ?? "urgency",
    page: Number(params.get("page") ?? 1),
  };
  const queue = useQueue(filters);
  const stats = useStats();

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page"); // new filters start from page 1
    setParams(next, { replace: true });
  };

  const s = stats.data;
  const totalPages = queue.data ? Math.max(1, Math.ceil(queue.data.total / queue.data.pageSize)) : 1;

  return (
    <>
      <div className="page-head">
        <h1>Ticket queue</h1>
      </div>

      {s && (
        <section className="stats">
          <button className="stat" onClick={() => setParams({ status: "open" })}><span>Open</span><strong>{s.queue.open}</strong></button>
          <button className="stat" onClick={() => setParams({ status: "in_progress" })}><span>In progress</span><strong>{s.queue.inProgress}</strong></button>
          <button className={`stat ${s.queue.activeCritical ? "stat-alert" : ""}`} onClick={() => setParams({ priority: "critical" })}>
            <span>Critical (active)</span><strong>{s.queue.activeCritical}</strong>
          </button>
          <button className="stat" onClick={() => setParams({ assignee: "unassigned" })}><span>Unassigned</span><strong>{s.queue.unassigned}</strong></button>
          <button className={`stat ${s.queue.aiFailed ? "stat-warn" : ""}`} onClick={() => setParams({ priority: "unclassified", status: "" })}>
            <span>Needs manual triage</span><strong>{s.queue.aiFailed}</strong>
          </button>
          <div className="stat" title="Share of AI-classified tickets whose category was changed by staff">
            <span>AI category overrides</span>
            <strong>{s.ai.classified ? `${Math.round((s.ai.categoryOverrides / s.ai.classified) * 100)}%` : "—"}</strong>
          </div>
        </section>
      )}
      {s && !s.ai.enabled && (
        <div className="alert alert-warn">AI is not configured on this server. Tickets need manual triage and replies are written by hand.</div>
      )}

      <div className="filters card">
        <select value={filters.status} onChange={(e) => setFilter("status", e.target.value)} aria-label="Status">
          <option value="open,in_progress">Active (open + in progress)</option>
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
        <select value={filters.assignee ?? ""} onChange={(e) => setFilter("assignee", e.target.value)} aria-label="Assignee">
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <label className="inline">From <input type="date" value={filters.from ?? ""} onChange={(e) => setFilter("from", e.target.value)} /></label>
        <label className="inline">To <input type="date" value={filters.to ?? ""} onChange={(e) => setFilter("to", e.target.value)} /></label>
        <input type="search" placeholder="Search subject or author" defaultValue={filters.q}
          onKeyDown={(e) => e.key === "Enter" && setFilter("q", e.currentTarget.value)} />
        <select value={filters.sort} onChange={(e) => setFilter("sort", e.target.value)} aria-label="Sort">
          <option value="urgency">Most urgent first</option>
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
        </select>
        {params.toString() && <button className="btn btn-ghost" onClick={() => setParams({})}>Reset</button>}
      </div>

      <ErrorBox error={queue.error} />
      {queue.isPending ? (
        <Loading />
      ) : queue.data && queue.data.data.length === 0 ? (
        <EmptyState title="No tickets match these filters">Try widening the status or date range.</EmptyState>
      ) : (
        queue.data && (
          <div className="table-wrap">
            <table className="queue">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Ticket</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th title="Time since the ticket was opened. Red = first reply is overdue for its priority.">Age</th>
                </tr>
              </thead>
              <tbody>
                {queue.data.data.map((t) => (
                  <tr key={t.id} className={t.firstResponseOverdue ? "row-overdue" : ""}>
                    <td>
                      <PriorityBadge priority={t.priority} />
                      {t.aiStatus === "pending" && <div className="muted small">AI triaging…</div>}
                    </td>
                    <td>
                      <Link to={`/admin/tickets/${t.id}`}><strong>{t.subject}</strong></Link>
                      <div className="muted small">#{t.id} · {t.authorName} · {t.bookTitle ?? "General / Account"}</div>
                    </td>
                    <td>
                      {t.category ? CATEGORY_LABELS[t.category] : <span className="muted">—</span>}
                      {t.category && t.aiCategory && t.category !== t.aiCategory && <div className="muted small">overridden</div>}
                    </td>
                    <td><StatusBadge status={t.status} /></td>
                    <td>{t.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                    <td className={t.firstResponseOverdue ? "overdue" : ""} title={`First-reply target: ${t.slaHours}h`}>
                      {age(t.createdAt)}
                      {t.firstResponseOverdue && <div className="small">reply overdue</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {totalPages > 1 && (
        <div className="pager">
          <button className="btn btn-ghost" disabled={filters.page! <= 1} onClick={() => setFilter("page", String(filters.page! - 1))}>← Prev</button>
          <span className="muted">Page {filters.page} of {totalPages}</span>
          <button className="btn btn-ghost" disabled={filters.page! >= totalPages} onClick={() => setFilter("page", String(filters.page! + 1))}>Next →</button>
        </div>
      )}
    </>
  );
}
