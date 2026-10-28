import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";
import { api, ApiError } from "../api/client";
import type { User } from "../api/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // Ask the server who we are. The httpOnly cookie isn't readable from JS, by design.
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api<{ user: User }>("/auth/me")
        .then((r) => r.user)
        .catch((e) => (e instanceof ApiError && e.status === 401 ? null : Promise.reject(e))),
    staleTime: Infinity,
    retry: false,
  });

  // Drop cached data from the previous user, but keep the "me" query itself: removing it would
  // disconnect the hook above, and the app would never see the new login.
  const forgetPreviousUser = () => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });

  const value: AuthState = {
    user: me.data ?? null,
    loading: me.isPending,
    login: async (email, password) => {
      const { user } = await api<{ user: User }>("/auth/login", { method: "POST", body: { email, password } });
      forgetPreviousUser();
      qc.setQueryData(["me"], user);
      return user;
    },
    logout: async () => {
      await api("/auth/logout", { method: "POST" });
      forgetPreviousUser();
      qc.setQueryData(["me"], null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
