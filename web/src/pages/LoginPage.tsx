import { type FormEvent, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import type { Role } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ErrorBox } from "../components/ui";

// Demo accounts, shown on the login page so evaluators can try each side in one click.
const DEMO_ACCOUNTS: Record<Role, { label: string; email: string; password: string }[]> = {
  author: [
    { label: "Priya Sharma (2 published books)", email: "priya.sharma@email.com", password: "author123" },
    { label: "Sneha Kulkarni (1 book in production)", email: "sneha.kulkarni@email.com", password: "author123" },
    { label: "Ananya Reddy (royalty never paid)", email: "ananya.reddy@email.com", password: "author123" },
  ],
  admin: [
    { label: "Neha Gupta", email: "admin@bookleaf.com", password: "admin123" },
    { label: "Karan Mehta", email: "support@bookleaf.com", password: "admin123" },
  ],
};

const COPY: Record<Role, { title: string; subtitle: string }> = {
  author: { title: "Author login", subtitle: "Track your books and royalties, and get help from our team." },
  admin: { title: "Support team login", subtitle: "Manage incoming author tickets." },
};

const homeFor = (role: Role) => (role === "admin" ? "/admin/tickets" : "/books");

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  // ?as=admin opens the admin tab directly, e.g. a link for the ops team.
  const [params, setParams] = useSearchParams();
  const tab: Role = params.get("as") === "admin" ? "admin" : "author";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  function switchTab(next: Role) {
    setParams(next === "admin" ? { as: "admin" } : {}, { replace: true });
    setEmail("");
    setPassword("");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The tab is just for convenience: the account itself decides which portal you land in.
      const u = await login(email, password);
      navigate(homeFor(u.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">BookLeaf Publishing</div>
        <div className="tabs">
          <button type="button" className={tab === "author" ? "active" : ""} onClick={() => switchTab("author")}>
            Author
          </button>
          <button type="button" className={tab === "admin" ? "active" : ""} onClick={() => switchTab("admin")}>
            Admin
          </button>
        </div>

        <div>
          <h1>{COPY[tab].title}</h1>
          <p className="muted">{COPY[tab].subtitle}</p>
        </div>
        <ErrorBox error={error} />
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <div className="demo-accounts">
          <div className="muted small">Demo {tab} accounts (click to fill in)</div>
          {DEMO_ACCOUNTS[tab].map((a) => (
            <button
              type="button"
              key={a.email}
              className="btn btn-link"
              onClick={() => {
                setEmail(a.email);
                setPassword(a.password);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
