"use client";

import { ArrowLeft, OctagonAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Avatar, Card, PageHeader } from "@/components/ui/misc";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import type { ReportDetail } from "@/lib/reports/service";
import { formatHours, formatWeekRange } from "@/lib/utils";
import { ReportActions } from "./report-actions";
import { ProjectBreakdown, ReviewHistory, TasksByDay } from "./report-parts";
import { ReportStatusBadge } from "./report-status-badge";

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-muted text-xs">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? ""}`}>{value}</p>
    </Card>
  );
}

export function ReportDetailView({ report }: { report: ReportDetail }) {
  const back = report.permissions.isOwner
    ? { href: "/tasks?tab=weekly", label: "My weeks" }
    : { href: "/reviews", label: "Reviews" };
  const waitingFor =
    report.currentApprover && !report.permissions.canReview
      ? `Waiting for ${report.currentApprover.name}`
      : null;

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-3">
        <Link href={back.href}>
          <ArrowLeft />
          {back.label}
        </Link>
      </Button>
      <PageHeader
        title={`Week ${report.isoWeek}`}
        description={formatWeekRange(report.weekStart, report.weekEnd)}
        actions={<ReportActions report={report} />}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        {report.owner ? (
          <span className="flex items-center gap-2">
            <Avatar name={report.owner.name} color={report.owner.avatarColor} className="size-7 text-[10px]" />
            <span className="font-medium">{report.owner.name}</span>
            <span className="text-muted-on-background">{ROLE_LABELS[report.owner.role as Role]}</span>
          </span>
        ) : null}
        <ReportStatusBadge status={report.status} />
        {waitingFor ? <span className="text-muted-on-background">{waitingFor}</span> : null}
      </div>

      {report.totals.blockedCount > 0 ? (
        <div className="bg-surface border-danger mb-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm">
          <OctagonAlert className="text-danger size-4" aria-hidden />
          <span>
            {report.totals.blockedCount} blocked task{report.totals.blockedCount === 1 ? "" : "s"} this week.
          </span>
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Hours" value={formatHours(report.totals.hours)} />
        <Stat label="Tasks" value={report.totals.taskCount} />
        <Stat label="Completed" value={report.totals.completedCount} />
        <Stat label="Blocked" value={report.totals.blockedCount} tone={report.totals.blockedCount ? "text-danger" : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">Tasks by day</h2>
          <TasksByDay tasks={report.tasks} />
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">By project</h2>
            {report.totals.byProject.length ? (
              <ProjectBreakdown rows={report.totals.byProject} />
            ) : (
              <p className="text-muted text-sm">No hours yet.</p>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">Review history</h2>
            <ReviewHistory trail={report.trail} />
          </Card>
        </div>
      </div>
    </>
  );
}
