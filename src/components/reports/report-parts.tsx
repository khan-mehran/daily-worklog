"use client";

import { MessageSquareText, OctagonAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, Badge, ColorDot } from "@/components/ui/misc";
import { paletteVar, type TaskStatus } from "@/lib/constants";
import { cn, formatHours, formatWeekday } from "@/lib/utils";

export interface DayTask {
  id: string;
  date: string;
  details: string;
  hours: number | null;
  status: TaskStatus | string;
  project: { name: string; color: string };
}

export function TaskStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      className={cn(
        status === "Blocked" && "border-danger text-danger font-semibold",
        status === "In Progress" && "text-info",
        status === "Completed" && "text-success-text",
      )}
    >
      {status === "Blocked" ? <OctagonAlert className="size-3" aria-hidden /> : null}
      {status}
    </Badge>
  );
}

const BULLET = /^\s*([•·\-*–])\s+(.*)$/;

/**
 * A task's details, line by line as typed. A line that starts with a bullet hangs: when it
 * wraps, the text stays lined up to the right of the bullet.
 */
export function TaskDetails({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {text.split(/\r?\n/).map((line, index) => {
        const bullet = BULLET.exec(line);
        if (!bullet) return <p key={index}>{line || " "}</p>;
        return (
          <p key={index} className="flex gap-2">
            <span aria-hidden className="shrink-0">
              •
            </span>
            <span className="min-w-0">{bullet[2]}</span>
          </p>
        );
      })}
    </div>
  );
}

/** One task line. Blocked tasks get a red edge as well as their badge. */
export function TaskRow({ task, actions }: { task: DayTask; actions?: ReactNode }) {
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5",
        task.status === "Blocked" && "border-l-danger border-l-4",
      )}
    >
      <div className="min-w-0 flex-1">
        <TaskDetails text={task.details} className="text-sm" />
        <p className="text-muted mt-1 flex flex-wrap items-center gap-x-2 text-xs">
          <span className="flex items-center gap-1.5">
            <ColorDot color={task.project.color} />
            {task.project.name}
          </span>
          {task.hours !== null ? <span>· {formatHours(task.hours)}</span> : null}
        </p>
      </div>
      <TaskStatusBadge status={task.status} />
      {actions}
    </li>
  );
}

/** Tasks grouped under their weekday, in date order. */
export function TasksByDay({ tasks }: { tasks: DayTask[] }) {
  const days = [...new Set(tasks.map((task) => task.date))].sort();
  if (days.length === 0) return <p className="text-muted text-sm">No tasks logged this week.</p>;
  return (
    <div className="space-y-4">
      {days.map((day) => {
        const dayTasks = tasks.filter((task) => task.date === day);
        const hours = dayTasks.reduce((sum, task) => sum + (task.hours ?? 0), 0);
        return (
          <section key={day} aria-label={formatWeekday(day)}>
            <h4 className="text-muted mb-2 flex justify-between text-xs font-semibold tracking-wide uppercase">
              <span>{formatWeekday(day)}</span>
              <span>{formatHours(hours)}</span>
            </h4>
            <ul className="space-y-2">
              {dayTasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function ProjectBreakdown({
  rows,
}: {
  rows: { projectId: string; name: string; color: string; hours: number }[];
}) {
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((row) => row.hours));
  return (
    <ul className="space-y-2.5" aria-label="Hours by project">
      {rows.map((row) => (
        <li key={row.projectId} className="text-sm">
          <div className="mb-1 flex justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <ColorDot color={row.color} />
              <span className="truncate">{row.name}</span>
            </span>
            <span className="font-semibold">{formatHours(row.hours)}</span>
          </div>
          <div className="bg-subtle h-1.5 rounded-full" aria-hidden>
            <div
              className="h-1.5 rounded-full"
              style={{ width: `${(row.hours / max) * 100}%`, background: paletteVar(row.color) }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

const TRAIL_LABELS: Record<string, string> = {
  SUBMITTED: "submitted the week",
  LEAD_APPROVED: "approved as Team Lead",
  MANAGER_APPROVED: "gave final approval",
  CEO_ACKNOWLEDGED: "acknowledged the week",
  CHANGES_REQUESTED: "requested changes",
};

export interface TrailEntry {
  action: string;
  by: { name: string; avatarColor: string } | null;
  at: string;
  comment: string | null;
}

export function ReviewHistory({ trail }: { trail: TrailEntry[] }) {
  if (trail.length === 0) {
    return <p className="text-muted text-sm">Nothing yet. The history starts when the week is submitted.</p>;
  }
  return (
    <ol className="space-y-3">
      {trail.map((entry, index) => (
        <li key={index} className="flex gap-3 text-sm">
          <Avatar
            name={entry.by?.name ?? "?"}
            color={entry.by?.avatarColor ?? "slate"}
            className="size-7 text-[10px]"
          />
          <div className="min-w-0">
            <p>
              <span className="font-medium">{entry.by?.name ?? "Someone"}</span>{" "}
              {TRAIL_LABELS[entry.action] ?? entry.action.toLowerCase()}
            </p>
            <p className="text-muted text-xs">
              {new Date(entry.at).toLocaleString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            {entry.comment ? (
              <p className="bg-subtle mt-1.5 flex gap-2 rounded-lg px-3 py-2">
                <MessageSquareText className="text-accent-text mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{entry.comment}</span>
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
