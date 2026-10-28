import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useTicketEvents } from "../lib/useTicketEvents";

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const live = useTicketEvents(Boolean(user));

  const links =
    user?.role === "admin"
      ? [{ to: "/admin/tickets", label: "Ticket queue" }]
      : [
          { to: "/books", label: "My books" },
          { to: "/tickets", label: "My tickets" },
          { to: "/tickets/new", label: "Get help" },
        ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          BookLeaf <span className="muted">{user?.role === "admin" ? "Support Desk" : "Author Support"}</span>
        </div>
        <nav>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          <span className={`live-dot ${live ? "on" : ""}`} title={live ? "Live updates connected" : "Reconnecting…"} />
          <span className="muted">{user?.name}</span>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            Log out
          </button>
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
