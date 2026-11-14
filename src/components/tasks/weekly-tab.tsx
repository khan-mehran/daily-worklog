"use client";

import { useMutation } from "@tanstack/react-query";
import { CalendarRange, ExternalLink, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ProjectBreakdown, ReviewHistory, TasksByDay } from "@/components/reports/report-parts";
import { ReportStatusBadge } from "@/components/reports/report-status-badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Card, EmptyState, Skeleton } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/pagination";
import { api } from "@/lib/api-client";
import { EDITABLE_STATUSES } from "@/lib/constants";
import { isoWeekOf, dayString } from "@/lib/reports/iso-week";
import type { ReportSummary } from "@/lib/reports/service";
import type { MyTask } from "@/lib/tasks/service";
import { formatHours, formatWeekRange } from "@/lib/utils";
import { useMyReports, useMyTasks, useRefreshWork } from "./use-tasks";

const WEEKS_PER_PAGE = 4;

interface WeekCardData {
  key: string;
  isoWeek: number;
  weekStart: string;
  weekEnd: string;
  report: ReportSummary | null;
}

function WeekCard({ week, tasks }: { week: WeekCardData; tasks: MyTask[] }) {
  const refresh = useRefreshWork();
  const [confirming, setConfirming] = useState(false);
  const { report } = week;
  const status = report?.status ?? "DRAFT";
  const editable = EDITABLE_STATUSES.includes(status);
  const hours = report?.totals.hours ?? 0;

  const submit = useMutation({
    mutationFn: () => api(`/api/reports/${report!.id}/submit`, { method: "POST" }),
    onSuccess: async () => {
      setConfirming(false);
      toast.success(`Week ${week.isoWeek} submitted. Your approver has been notified.`);
      await refresh();
    },
    onError: (error) => {
      setConfirming(false);
      toast.error(error.message);
    },
  });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Week {week.isoWeek}</h2>
          <p className="text-muted text-sm">{formatWeekRange(week.weekStart, week.weekEnd)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReportStatusBadge status={status} />
          {report ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/reports/${report.id}`}>
                <ExternalLink />
                Open
              </Link>
            </Button>
          ) : null}
          {editable && report && report.totals.taskCount > 0 ? (
            <Button size="sm" onClick={() => setConfirming(true)}>
              <Send />
              Submit week
            </Button>
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-y py-3 text-sm">
        <div>
          <dt className="text-muted text-xs">Hours</dt>
          <dd className="font-semibold">{formatHours(hours)}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Tasks</dt>
          <dd className="font-semibold">{report?.totals.taskCount ?? 0}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Blocked</dt>
          <dd className={report?.totals.blockedCount ? "text-danger font-semibold" : "font-semibold"}>
            {report?.totals.blockedCount ?? 0}
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_18rem]">
        <TasksByDay tasks={tasks} />
        <div className="space-y-6">
          {report && report.totals.byProject.length > 0 ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold">By project</h3>
              <ProjectBreakdown rows={report.totals.byProject} />
            </section>
          ) : null}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Review history</h3>
            <ReviewHistory trail={report?.trail ?? []} />
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Submit week ${week.isoWeek}?`}
        description="Your tasks for this week will be locked and sent to your approver. They unlock only if changes are requested."
        confirmLabel="Submit week"
        pending={submit.isPending}
        onConfirm={() => submit.mutate()}
      />
    </Card>
  );
}

export function WeeklyTab() {
  const [page, setPage] = useState(1);
  const reports = useMyReports(page, WEEKS_PER_PAGE);

  // The current week has no report until its first task, but it should always be on page one.
  const current = isoWeekOf(new Date());
  const weeks: WeekCardData[] = (reports.data?.data ?? []).map((report) => ({
    key: report.id,
    isoWeek: report.isoWeek,
    weekStart: report.weekStart,
    weekEnd: report.weekEnd,
    report,
  }));
  const currentStart = dayString(current.weekStart);
  if (page === 1 && reports.data && !weeks.some((week) => week.weekStart === currentStart)) {
    weeks.unshift({
      key: "current",
      isoWeek: current.isoWeek,
      weekStart: currentStart,
      weekEnd: dayString(current.weekEnd),
      report: null,
    });
  }

  const from = weeks.length ? weeks.map((week) => week.weekStart).sort()[0]! : currentStart;
  const to = weeks.length ? weeks.map((week) => week.weekEnd).sort().at(-1)! : currentStart;
  const tasks = useMyTasks(from, to);

  if (reports.isLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading weeks">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (reports.isError) {
    return (
      <Card>
        <EmptyState
          icon={CalendarRange}
          title="Couldn't load your weeks"
          description="Check your connection and try again."
          action={<Button variant="secondary" onClick={() => reports.refetch()}>Try again</Button>}
        />
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {weeks.map((week) => (
        <WeekCard
          key={week.key}
          week={week}
          tasks={(tasks.data?.tasks ?? []).filter(
            (task) => task.date >= week.weekStart && task.date <= week.weekEnd,
          )}
        />
      ))}
      <Pagination
        page={page}
        pageSize={WEEKS_PER_PAGE}
        total={reports.data?.meta.total ?? 0}
        noun="weeks"
        onPageChange={setPage}
      />
    </div>
  );
}
