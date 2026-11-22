"use client";

import { useMutation } from "@tanstack/react-query";
import { addDays, format, subDays } from "date-fns";
import { ChevronLeft, ChevronRight, Code2, Copy, ListChecks, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ReportStatusBadge } from "@/components/reports/report-status-badge";
import { TaskDetails, TaskStatusBadge } from "@/components/reports/report-parts";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { Badge, Card, ColorDot, EmptyState, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api-client";
import { EDITABLE_STATUSES } from "@/lib/constants";
import { localDay } from "@/lib/reports/iso-week";
import type { MyTask } from "@/lib/tasks/service";
import { cn, formatDay, formatHours } from "@/lib/utils";
import { reportForDay, useMyTasks, useRefreshWork } from "./use-tasks";

const shift = (day: string, by: number) =>
  format(by > 0 ? addDays(localDay(day), by) : subDays(localDay(day), -by), "yyyy-MM-dd");

export function DailyTab({
  date,
  onDateChange,
  onAdd,
  onEdit,
}: {
  date: string;
  onDateChange: (date: string) => void;
  onAdd: () => void;
  onEdit: (task: MyTask) => void;
}) {
  const refresh = useRefreshWork();
  const { data, isLoading, isError, refetch } = useMyTasks(date, date);
  const [deleting, setDeleting] = useState<MyTask | null>(null);
  const report = data ? reportForDay(data.reports, date) : null;
  const editable = !report || EDITABLE_STATUSES.includes(report.status);
  const tasks = data?.tasks ?? [];
  const totalHours = tasks.reduce((sum, task) => sum + (task.hours ?? 0), 0);

  const copy = useMutation({
    mutationFn: () =>
      api<{ copied: number; skipped: number; from: string }>("/api/tasks/copy", {
        method: "POST",
        body: { date },
      }),
    onSuccess: async (result) => {
      const skipped = result.skipped ? ` ${result.skipped} skipped: those projects are no longer open to you.` : "";
      toast.success(`Copied ${result.copied} task${result.copied === 1 ? "" : "s"} from ${formatDay(result.from)}.${skipped}`);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/tasks/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Task deleted.");
      setDeleting(null);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="icon" aria-label="Previous day" onClick={() => onDateChange(shift(date, -1))}>
          <ChevronLeft />
        </Button>
        <Input
          type="date"
          aria-label="Day"
          value={date}
          onChange={(event) => event.target.value && onDateChange(event.target.value)}
          className="w-44"
        />
        <Button variant="secondary" size="icon" aria-label="Next day" onClick={() => onDateChange(shift(date, 1))}>
          <ChevronRight />
        </Button>
        <Button variant="ghost" onClick={() => onDateChange(format(new Date(), "yyyy-MM-dd"))}>
          Today
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          {editable ? (
            <>
              <Button variant="secondary" disabled={copy.isPending} onClick={() => copy.mutate()}>
                <Copy />
                Copy previous day
              </Button>
              <Button onClick={onAdd} aria-keyshortcuts="n">
                <Plus />
                Add task
                <kbd className="ml-1 hidden rounded border border-current/30 px-1 text-[10px] sm:inline">N</kbd>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {report && !editable ? (
        <div className="bg-surface flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm">
          <Lock className="text-muted size-4" aria-hidden />
          <span>This week is submitted, so its tasks are locked.</span>
          <ReportStatusBadge status={report.status} />
          <Link href={`/reports/${report.id}`} className="text-primary ml-auto font-medium underline">
            View report
          </Link>
        </div>
      ) : null}
      {report?.status === "CHANGES_REQUESTED" ? (
        <div className="bg-surface border-accent rounded-xl border px-4 py-3 text-sm">
          <p className="font-medium">Changes were requested on this week.</p>
          <p className="text-muted mt-0.5">{report.trail.at(-1)?.comment}</p>
        </div>
      ) : null}

      <Card className="p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">{formatDay(date)}</h2>
          <span className="text-muted text-sm">
            {tasks.length} task{tasks.length === 1 ? "" : "s"} · {formatHours(totalHours)}
          </span>
        </div>
        {isLoading ? (
          <div className="space-y-2" role="status" aria-label="Loading tasks">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : isError ? (
          <EmptyState
            icon={ListChecks}
            title="Couldn't load your tasks"
            description="Check your connection and try again."
            action={<Button variant="secondary" onClick={() => refetch()}>Try again</Button>}
          />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="Nothing logged for this day"
            description={
              editable
                ? "Add what you worked on, or copy your previous day's tasks and adjust them."
                : "No tasks were logged on this day."
            }
            action={editable ? <Button onClick={onAdd}><Plus />Add task</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-subtle text-muted text-left text-xs font-semibold tracking-wide uppercase">
                <tr>
                  <th scope="col" className="w-48 px-4 py-2.5">Project</th>
                  <th scope="col" className="px-4 py-2.5">Tasks</th>
                  <th scope="col" className="w-36 px-4 py-2.5">Status</th>
                  {editable ? (
                    <th scope="col" className="w-28 px-4 py-2.5 text-right">Actions</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y">
                {tasks.map((task) => (
                  <tr key={task.id} className="align-top">
                    <td
                      className={cn(
                        "px-4 py-3",
                        task.status === "Blocked" && "border-l-danger border-l-4",
                      )}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <ColorDot color={task.project.color} />
                        <span className="truncate">{task.project.name}</span>
                      </span>
                      {task.hours !== null ? (
                        <span className="text-muted mt-0.5 block pl-4 text-xs">{formatHours(task.hours)}</span>
                      ) : null}
                      {task.source === "sync" ? (
                        <Badge
                          className="text-muted mt-1 ml-4 px-2 py-0 text-[0.7rem]"
                          title="Written by the VS Code daily sync. Edit it and later syncs leave it alone."
                        >
                          <Code2 className="size-3" aria-hidden />
                          VS Code
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <TaskDetails text={task.details} />
                    </td>
                    <td className="px-4 py-3">
                      <TaskStatusBadge status={task.status} />
                    </td>
                    {editable ? (
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon" aria-label="Edit task" onClick={() => onEdit(task)}>
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete task"
                            onClick={() => setDeleting(task)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this task?"
        description={deleting?.details.slice(0, 140) ?? ""}
        confirmLabel="Delete task"
        danger
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
