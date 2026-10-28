import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { Role } from "./api/types";
import { useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { AdminTicketPage } from "./pages/admin/AdminTicketPage";
import { QueuePage } from "./pages/admin/QueuePage";
import { AuthorTicketPage } from "./pages/author/AuthorTicketPage";
import { BooksPage } from "./pages/author/BooksPage";
import { MyTicketsPage } from "./pages/author/MyTicketsPage";
import { NewTicketPage } from "./pages/author/NewTicketPage";
import { LoginPage } from "./pages/LoginPage";

/**
 * Client-side route guard. This is only UX: it keeps people off pages they can't use.
 * The real access control is on the server, which checks the session and role on every API call.
 */
function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={user.role === "admin" ? "/admin/tickets" : "/books"} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireRole role="author"><Layout /></RequireRole>}>
        <Route path="/books" element={<BooksPage />} />
        <Route path="/tickets" element={<MyTicketsPage />} />
        <Route path="/tickets/new" element={<NewTicketPage />} />
        <Route path="/tickets/:id" element={<AuthorTicketPage />} />
      </Route>
      <Route element={<RequireRole role="admin"><Layout /></RequireRole>}>
        <Route path="/admin/tickets" element={<QueuePage />} />
        <Route path="/admin/tickets/:id" element={<AdminTicketPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
