import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "./client";
import type {
  AuthorTicketDetail, Book, Draft, RoyaltySummary, StaffTicket, StaffTicketDetail,
  TicketBase, TicketCategory, TicketPriority, TicketStatus,
} from "./types";

// Server data goes through React Query (caching + loading/error states). Live updates from the
// server just invalidate these queries (see useTicketEvents).

export const keys = {
  ticketList: (filters: object) => ["tickets", "list", filters] as const,
  ticket: (id: number) => ["tickets", "detail", id] as const,
  draft: (id: number) => ["draft", id] as const,
};

export const useBooks = () =>
  useQuery({ queryKey: ["books"], queryFn: () => api<{ data: Book[]; royalty: RoyaltySummary }>("/books") });

export const useMyTickets = () =>
  useQuery({ queryKey: keys.ticketList({}), queryFn: () => api<{ data: TicketBase[] }>("/tickets").then((r) => r.data) });

export interface QueueFilters {
  status?: string;
  category?: string;
  priority?: string;
  from?: string;
  to?: string;
}

export const useQueue = (filters: QueueFilters) =>
  useQuery({
    queryKey: keys.ticketList(filters),
    queryFn: () => api<{ data: StaffTicket[] }>(`/tickets${qs({ ...filters })}`).then((r) => r.data),
    placeholderData: (prev) => prev, // keep the table on screen while filters change
  });

export const useAuthorTicket = (id: number) =>
  useQuery({ queryKey: keys.ticket(id), queryFn: () => api<{ data: AuthorTicketDetail }>(`/tickets/${id}`).then((r) => r.data) });

export const useStaffTicket = (id: number) =>
  useQuery({ queryKey: keys.ticket(id), queryFn: () => api<{ data: StaffTicketDetail }>(`/tickets/${id}`).then((r) => r.data) });

/** The AI draft. Loaded once and never refetched automatically, so it can't overwrite the admin's edits. */
export const useDraft = (id: number, enabled: boolean) =>
  useQuery({
    queryKey: keys.draft(id),
    queryFn: () => api<{ data: Draft }>(`/tickets/${id}/draft`).then((r) => r.data),
    enabled,
    retry: false,
    staleTime: Infinity,
  });

/** After a change: show the updated ticket straight away and refresh the lists. */
function useTicketMutation<TVars>(fn: (vars: TVars) => Promise<{ data: StaffTicketDetail | AuthorTicketDetail }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: ({ data }) => {
      qc.setQueryData(keys.ticket(data.id), data);
      void qc.invalidateQueries({ queryKey: ["tickets", "list"] });
    },
  });
}

export const useCreateTicket = () =>
  useTicketMutation((body: { bookId: string | null; subject: string; description: string }) =>
    api<{ data: AuthorTicketDetail }>("/tickets", { method: "POST", body }),
  );

export const useSendMessage = (id: number) =>
  useTicketMutation((body: { body: string; internal: boolean }) =>
    api<{ data: StaffTicketDetail }>(`/tickets/${id}/messages`, { method: "POST", body }),
  );

export const useUpdateTicket = (id: number) =>
  useTicketMutation(
    (body: { status?: TicketStatus; category?: TicketCategory; priority?: TicketPriority; assigneeId?: number | null }) =>
      api<{ data: StaffTicketDetail }>(`/tickets/${id}`, { method: "PATCH", body }),
  );

export const useRetryClassification = (id: number) =>
  useTicketMutation(() => api<{ data: StaffTicketDetail }>(`/tickets/${id}/classify`, { method: "POST" }));

export const useRegenerateDraft = (id: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ data: Draft }>(`/tickets/${id}/draft`, { method: "POST" }).then((r) => r.data),
    onSuccess: (draft) => qc.setQueryData(keys.draft(id), draft),
  });
};
