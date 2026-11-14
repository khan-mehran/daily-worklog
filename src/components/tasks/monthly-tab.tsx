"use client";

import { addMonths, endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { ProjectBreakdown } from "@/components/reports/report-parts";
import { ReportStatusBadge } from "@/components/reports/report-status-badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Skeleton } from "@/components/ui/misc";
import { formatHours, formatWeekRange } from "@/lib/utils";
import { useMyTasks } from "./use-tasks";

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-muted text-xs">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? ""}`}>{value}</p>
    </Card>
  );
}

/** A read-only roll-up of one month: its weeks, hours by project and completion. */
export function MonthlyTab({ month, onMonthChange }: { month: Date; onMonthChange: (month: Date) => void }) {
  const from = format(startOfMonth(month), "yyyy-MM-dd");
  const to = format(endOfMonth(month), "yyyy-MM-dd");
  const { data, isLoading, isError, refetch } = useMyTasks(from, to);
  const tasks = data?.tasks ?? [];

  const hours = tasks.reduce((sum, task) => sum + (task.hours ?? 0), 0);
  const completed = tasks.filter((task) => task.status === "Completed").length;
  const blocked = tasks.filter((task) => task.status === "Blocked").length;
  const byProject = [
    ...tasks
      .reduce((map, task) => {
        const row = map.get(task.project.id) ?? {
          projectId: task.project.id,
          name: task.project.name,
          color: task.project.color,
          hours: 0,
        };
        row.hours += task.hours ?? 0;
        return map.set(task.project.id, row);
      }, new Map<string, { projectId: string; name: string; color: string; hours: number }>())
      .values(),
  ].sort((a, b) => b.hours - a.hours);
  const weeks = [...(data?.reports ?? [])].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="icon" aria-label="Previous month" onClick={() => onMonthChange(subMonths(month, 1))}>
          <ChevronLeft />
        </Button>
        <h2 className="min-w-40 text-center font-semibold">{format(month, "MMMM yyyy")}</h2>
        <Button variant="secondary" size="icon" aria-label="Next month" onClick={() => onMonthChange(addMonths(month, 1))}>
          <ChevronRight />
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-4" role="status" aria-label="Loading month">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-20 rounded-xl" />)}
        </div>
      ) : isError ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Couldn't load this month"
            description="Check your connection and try again."
            action={<Button variant="secondary" onClick={() => refetch()}>Try again</Button>}
          />
        </Card>
      ) : tasks.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarDays} title="Nothing logged this month" description="Tasks you log will be summarised here." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Kpi label="Hours" value={formatHours(hours)} />
            <Kpi label="Tasks" value={tasks.length} />
            <Kpi label="Completion rate" value={`${Math.round((completed / tasks.length) * 100)}%`} />
            <Kpi label="Blocked" value={blocked} tone={blocked ? "text-danger" : undefined} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-3 font-semibold">Weeks</h3>
              <ul className="divide-y">
                {weeks.map((week) => (
                  <li key={week.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <Link href={`/reports/${week.id}`} className="min-w-0 flex-1 font-medium hover:underline">
                      Week {week.isoWeek}
                      <span className="text-muted ml-2 font-normal">{formatWeekRange(week.weekStart, week.weekEnd)}</span>
                    </Link>
                    <span className="text-muted">{formatHours(week.totals.hours)}</span>
                    <ReportStatusBadge status={week.status} />
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 font-semibold">Hours by project</h3>
              <ProjectBreakdown rows={byProject} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
