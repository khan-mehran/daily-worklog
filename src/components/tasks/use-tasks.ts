"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiRequest, type Paginated } from "@/lib/api-client";
import type { ProjectSummary } from "@/lib/projects/service";
import type { ReportSummary } from "@/lib/reports/service";
import type { MyTask } from "@/lib/tasks/service";

export interface TaskRange {
  tasks: MyTask[];
  reports: ReportSummary[];
}

export function useMyTasks(from: string, to: string) {
  return useQuery({
    queryKey: ["tasks", from, to],
    queryFn: () => api<TaskRange>(`/api/tasks?from=${from}&to=${to}`),
  });
}

export function useMyReports(page: number, limit: number) {
  return useQuery({
    queryKey: ["reports", "mine", page, limit],
    queryFn: () => apiRequest<Paginated<ReportSummary>>(`/api/reports/mine?page=${page}&limit=${limit}`),
  });
}

/** Projects this person can log against: the API already limits developers to their own. */
export function useLoggableProjects(enabled = true) {
  return useQuery({
    queryKey: ["projects", "loggable"],
    queryFn: async () =>
      (await api<ProjectSummary[]>("/api/projects?limit=100")).filter(
        (project) => project.status !== "Completed",
      ),
    enabled,
  });
}

/** Everything that shows tasks or report state, refreshed after a change. */
export function useRefreshWork() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ["tasks", "reports", "review-queue", "dashboard", "notifications"].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export const reportForDay = (reports: ReportSummary[], day: string) =>
  reports.find((report) => report.weekStart <= day && day <= report.weekEnd) ?? null;
