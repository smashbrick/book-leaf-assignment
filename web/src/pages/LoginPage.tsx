import { type FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErrorBox } from "../components/ui";

// Demo accounts are listed on the login page so evaluators can switch roles in one click.
const DEMO_ACCOUNTS = [
  { label: "Author: Priya Sharma (2 books)", email: "priya.sharma@email.com", password: "author123" },
  { label: "Author: Sneha Kulkarni (1 in production)", email: "sneha.kulkarni@email.com", password: "author123" },
  { label: "Author: Ananya Reddy (never paid)", email: "ananya.reddy@email.com", password: "author123" },
  { label: "Admin: Neha Gupta", email: "admin@bookleaf.com", password: "admin123" },
  { label: "Admin: Karan Mehta", email: "support@bookleaf.com", password: "admin123" },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === "admin" ? "/admin/tickets" : "/books"} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      navigate(u.role === "admin" ? "/admin/tickets" : "/books", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <h1>BookLeaf Author Support</h1>
        <p className="muted">Sign in to track your books and get help from our team.</p>
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
          <div className="muted small">Demo accounts (click to fill)</div>
          {DEMO_ACCOUNTS.map((a) => (
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
