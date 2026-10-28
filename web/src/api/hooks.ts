import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "./client";
import type {
  AuthorTicketDetail, Book, Draft, Paged, RoyaltySummary, Staff, StaffTicket, StaffTicketDetail, Stats,
  TicketBase, TicketCategory, TicketPriority, TicketStatus,
} from "./types";

// All server state goes through React Query: caching, loading/error states, and re-fetching when
// a Server-Sent Event says something changed (see useTicketEvents).

export const keys = {
  books: ["books"] as const,
  tickets: ["tickets"] as const,
  ticketList: (filters: object) => ["tickets", "list", filters] as const,
  ticket: (id: number) => ["tickets", "detail", id] as const,
  draft: (id: number) => ["draft", id] as const,
  staff: ["staff"] as const,
  stats: ["stats"] as const,
};

export const useBooks = () =>
  useQuery({ queryKey: keys.books, queryFn: () => api<{ data: Book[]; royalty: RoyaltySummary }>("/books") });

export interface QueueFilters {
  status?: string;
  category?: string;
  priority?: string;
  assignee?: string;
  from?: string;
  to?: string;
  q?: string;
  sort?: string;
  page?: number;
}

export const useMyTickets = () =>
  useQuery({ queryKey: keys.ticketList({ mine: true }), queryFn: () => api<Paged<TicketBase>>("/tickets?pageSize=100&sort=newest") });

export const useQueue = (filters: QueueFilters) =>
  useQuery({
    queryKey: keys.ticketList(filters),
    queryFn: () => api<Paged<StaffTicket>>(`/tickets${qs({ ...filters })}`),
    placeholderData: (prev) => prev, // keep the table on screen while filters change
  });

export const useAuthorTicket = (id: number) =>
  useQuery({ queryKey: keys.ticket(id), queryFn: () => api<{ data: AuthorTicketDetail }>(`/tickets/${id}`).then((r) => r.data) });

export const useStaffTicket = (id: number) =>
  useQuery({ queryKey: keys.ticket(id), queryFn: () => api<{ data: StaffTicketDetail }>(`/tickets/${id}`).then((r) => r.data) });

/** The AI draft. Generated on first load, never auto-refetched, so it can't overwrite an admin's edits. */
export const useDraft = (id: number, enabled: boolean) =>
  useQuery({
    queryKey: keys.draft(id),
    queryFn: () => api<{ data: Draft }>(`/tickets/${id}/draft`).then((r) => r.data),
    enabled,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

export const useStaff = () =>
  useQuery({ queryKey: keys.staff, queryFn: () => api<{ data: Staff[] }>("/admin/staff").then((r) => r.data), staleTime: Infinity });

export const useStats = () => useQuery({ queryKey: keys.stats, queryFn: () => api<{ data: Stats }>("/admin/stats").then((r) => r.data) });

/** After any write, refresh ticket lists and stats. The detail view is updated from the response. */
function useTicketMutation<TVars>(fn: (vars: TVars) => Promise<{ data: StaffTicketDetail | AuthorTicketDetail }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: ({ data }) => {
      qc.setQueryData(keys.ticket(data.id), data);
      void qc.invalidateQueries({ queryKey: ["tickets", "list"] });
      void qc.invalidateQueries({ queryKey: keys.stats });
    },
  });
}

export const useCreateTicket = () =>
  useTicketMutation((body: { bookId: string | null; subject: string; description: string }) =>
    api<{ data: AuthorTicketDetail }>("/tickets", { method: "POST", body }),
  );

export const useSendMessage = (id: number) =>
  useTicketMutation((body: { body: string; internal?: boolean; usedAiDraft?: boolean; setStatus?: TicketStatus }) =>
    api<{ data: StaffTicketDetail }>(`/tickets/${id}/messages`, { method: "POST", body }),
  );

export const useUpdateTicket = (id: number) =>
  useTicketMutation(
    (body: { status?: TicketStatus; category?: TicketCategory; priority?: TicketPriority; assigneeId?: number | null }) =>
      api<{ data: StaffTicketDetail }>(`/tickets/${id}`, { method: "PATCH", body }),
  );

export const useRetryClassification = (id: number) =>
  useTicketMutation(() => api<{ data: StaffTicketDetail }>(`/tickets/${id}/classification`, { method: "POST" }));

export const useRegenerateDraft = (id: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ data: Draft }>(`/tickets/${id}/draft`, { method: "POST" }).then((r) => r.data),
    onSuccess: (draft) => qc.setQueryData(keys.draft(id), draft),
  });
};
