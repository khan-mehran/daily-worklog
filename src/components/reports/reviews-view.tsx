"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { CheckCheck, ClipboardCheck, OctagonAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useRefreshWork } from "@/components/tasks/use-tasks";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Avatar, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/pagination";
import { api, apiRequest, type Paginated } from "@/lib/api-client";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import type { ReportSummary } from "@/lib/reports/service";
import { formatHours, formatWeekRange } from "@/lib/utils";
import { ReportStatusBadge } from "./report-status-badge";

const PAGE_SIZE = 20;

export function ReviewsView() {
  const refresh = useRefreshWork();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["review-queue", page],
    queryFn: () => apiRequest<Paginated<ReportSummary>>(`/api/reports/review-queue?page=${page}&limit=${PAGE_SIZE}`),
  });
  const reports = data?.data ?? [];

  // Bulk approve runs the same single-report endpoint for each, so every rule still applies.
  const bulk = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) => api(`/api/reports/${id}/approve`, { method: "POST" })),
      );
      return results.filter((result) => result.status === "rejected").length;
    },
    onSuccess: async (failed, ids) => {
      setConfirming(false);
      setSelected(new Set());
      const done = ids.length - failed;
      if (done) toast.success(`Approved ${done} report${done === 1 ? "" : "s"}.`);
      if (failed) toast.error(`${failed} couldn't be approved. They may have changed. Reload and try again.`);
      await refresh();
    },
  });

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = reports.length > 0 && reports.every((report) => selected.has(report.id));

  return (
    <>
      <PageHeader
        title="Reviews"
        description="Weekly reports waiting for you, oldest first."
        actions={
          selected.size > 0 ? (
            <Button onClick={() => setConfirming(true)}>
              <CheckCheck />
              Approve {selected.size} selected
            </Button>
          ) : null
        }
      />
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5" role="status" aria-label="Loading reviews">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-14" />)}
          </div>
        ) : isError ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Couldn't load your reviews"
            description="Check your connection and try again."
            action={<Button variant="secondary" onClick={() => refetch()}>Try again</Button>}
          />
        ) : reports.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="You're all caught up" description="Reports appear here when someone submits a week to you." />
        ) : (
          <>
            <label className="text-muted flex items-center gap-3 border-b px-5 py-3 text-xs font-medium">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(reports.map((report) => report.id)))}
              />
              Select all on this page
            </label>
            <ul className="divide-y">
              {reports.map((report) => (
                <li key={report.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    aria-label={`Select ${report.owner?.name}'s week ${report.isoWeek}`}
                    checked={selected.has(report.id)}
                    onChange={() => toggle(report.id)}
                  />
                  <Avatar name={report.owner?.name ?? "?"} color={report.owner?.avatarColor ?? "slate"} />
                  <Link href={`/reports/${report.id}`} className="min-w-0 flex-1 hover:underline">
                    <p className="truncate font-medium">
                      {report.owner?.name}
                      <span className="text-muted ml-2 text-xs font-normal">
                        {ROLE_LABELS[report.owner?.role as Role]}
                      </span>
                    </p>
                    <p className="text-muted text-sm">
                      Week {report.isoWeek} · {formatWeekRange(report.weekStart, report.weekEnd)}
                      {report.submittedAt
                        ? ` · submitted ${formatDistanceToNow(new Date(report.submittedAt), { addSuffix: true })}`
                        : ""}
                    </p>
                  </Link>
                  {report.totals.blockedCount > 0 ? (
                    <span className="text-danger flex items-center gap-1 text-xs font-semibold">
                      <OctagonAlert className="size-3.5" aria-hidden />
                      {report.totals.blockedCount} blocked
                    </span>
                  ) : null}
                  <span className="text-sm font-semibold">{formatHours(report.totals.hours)}</span>
                  <ReportStatusBadge status={report.status} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.meta.total ?? 0} noun="reports" onPageChange={setPage} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Approve ${selected.size} report${selected.size === 1 ? "" : "s"}?`}
        description="Each one moves to its next step, and the next person is notified. Open a report first if you want to check its tasks."
        confirmLabel="Approve"
        pending={bulk.isPending}
        onConfirm={() => bulk.mutate([...selected])}
      />
    </>
  );
}
