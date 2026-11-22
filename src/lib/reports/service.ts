import type { Prisma } from "@prisma/client";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { ROLE_LABELS, type PaletteColor, type ReportStatus, type TaskStatus } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { notify } from "@/lib/notifications";
import { scopeFor, type Actor } from "@/lib/permissions";
import { getApprovalSettings } from "@/lib/site-settings/service";
import { dayString } from "./iso-week";
import { openableReportsFilter } from "./visibility";
import {
  isAwaitingReview,
  isEditableStatus,
  nextTransition,
  WorkflowError,
  type WorkflowAction,
} from "./workflow";

/** A report is always read with its per-project totals and its approval history, oldest first. */
export const REPORT_INCLUDE = {
  byProject: true,
  trail: { orderBy: [{ at: "asc" }, { id: "asc" }] },
} satisfies Prisma.WeeklyReportInclude;

export type ReportRecord = Prisma.WeeklyReportGetPayload<{ include: typeof REPORT_INCLUDE }>;

/** Rebuilds a report's cached totals from its tasks. */
export async function recomputeTotals(reportId: string) {
  await prisma.$transaction(async (tx) => {
    // Two tasks saved at once recompute one after the other, so neither writes stale totals.
    await tx.$queryRaw`SELECT 1 FROM "WeeklyReport" WHERE "id" = ${reportId}::uuid FOR UPDATE`;
    const rows = await tx.task.groupBy({
      by: ["projectId", "status"],
      where: { weeklyReportId: reportId },
      _sum: { hours: true },
      _count: { _all: true },
    });

    const byProject = new Map<string, { hours: number; taskCount: number }>();
    const totals = { totalHours: 0, taskCount: 0, completedCount: 0, blockedCount: 0 };
    for (const row of rows) {
      const hours = row._sum.hours ?? 0;
      const count = row._count._all;
      const project = byProject.get(row.projectId) ?? { hours: 0, taskCount: 0 };
      byProject.set(row.projectId, { hours: project.hours + hours, taskCount: project.taskCount + count });
      totals.totalHours += hours;
      totals.taskCount += count;
      if (row.status === "Completed") totals.completedCount += count;
      if (row.status === "Blocked") totals.blockedCount += count;
    }

    await tx.reportProjectTotal.deleteMany({ where: { reportId } });
    await tx.reportProjectTotal.createMany({
      data: [...byProject].map(([projectId, value]) => ({ reportId, projectId, ...value })),
    });
    await tx.weeklyReport.update({ where: { id: reportId }, data: totals });
  });
}

/** Turns reports into API objects, with project and people names in two queries in total. */
export async function serialiseReports(reports: ReportRecord[]) {
  const projectIds = [...new Set(reports.flatMap((report) => report.byProject.map((row) => row.projectId)))];
  const personIds = [
    ...new Set(
      reports.flatMap((report) => [
        report.userId,
        ...report.trail.map((entry) => entry.byUserId),
        ...(report.currentApproverId ? [report.currentApproverId] : []),
      ]),
    ),
  ];
  const [projects, people] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true, code: true, color: true },
    }),
    prisma.user.findMany({
      where: { id: { in: personIds } },
      select: { id: true, name: true, role: true, avatarColor: true },
    }),
  ]);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const personById = new Map(people.map((person) => [person.id, person]));
  const person = (id: string | null) => {
    const found = id ? personById.get(id) : undefined;
    return found
      ? { id: found.id, name: found.name, role: found.role, avatarColor: found.avatarColor as PaletteColor }
      : null;
  };

  return reports.map((report) => ({
    id: report.id,
    owner: person(report.userId),
    isoYear: report.isoYear,
    isoWeek: report.isoWeek,
    weekStart: dayString(report.weekStart),
    weekEnd: dayString(report.weekEnd),
    status: report.status,
    currentApprover: person(report.currentApproverId),
    submittedAt: report.submittedAt?.toISOString() ?? null,
    leadApprovedAt: report.leadApprovedAt?.toISOString() ?? null,
    managerApprovedAt: report.managerApprovedAt?.toISOString() ?? null,
    totals: {
      hours: report.totalHours,
      taskCount: report.taskCount,
      completedCount: report.completedCount,
      blockedCount: report.blockedCount,
      byProject: report.byProject
        .map((row) => {
          const project = projectById.get(row.projectId);
          return {
            projectId: row.projectId,
            name: project?.name ?? "Deleted project",
            color: (project?.color ?? "slate") as PaletteColor,
            hours: row.hours,
            taskCount: row.taskCount,
          };
        })
        .sort((a, b) => b.hours - a.hours),
    },
    trail: report.trail.map((entry) => ({
      action: entry.action,
      by: person(entry.byUserId),
      at: entry.at.toISOString(),
      comment: entry.comment,
    })),
  }));
}

export type ReportSummary = Awaited<ReturnType<typeof serialiseReports>>[number];

export async function listMyReports(actor: Actor, page: number, limit: number) {
  const where = { userId: actor.id };
  const [reports, total] = await Promise.all([
    prisma.weeklyReport.findMany({
      where,
      orderBy: { weekStart: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: REPORT_INCLUDE,
    }),
    prisma.weeklyReport.count({ where }),
  ]);
  return { reports: await serialiseReports(reports), total };
}

/** Reports waiting for this person, oldest first. The CEO's switcher narrows the queue. */
export async function reviewQueue(
  actor: Actor,
  selectedDepartmentId: string | null,
  page: number,
  limit: number,
) {
  const where: Prisma.WeeklyReportWhereInput = {
    ...scopeFor(actor, selectedDepartmentId),
    currentApproverId: actor.id,
    status: { in: ["SUBMITTED", "LEAD_APPROVED"] satisfies ReportStatus[] },
  };
  const [reports, total] = await Promise.all([
    prisma.weeklyReport.findMany({
      where,
      orderBy: { submittedAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
      include: REPORT_INCLUDE,
    }),
    prisma.weeklyReport.count({ where }),
  ]);
  return { reports: await serialiseReports(reports), total };
}

async function findOpenableReport(actor: Actor, id: string) {
  const report = await prisma.weeklyReport.findFirst({
    where: { AND: [{ id }, await openableReportsFilter(actor)] },
    include: REPORT_INCLUDE,
  });
  if (!report) throw notFound();
  return report;
}

/** A report with its tasks, for its owner, its approvers and those it has reached. */
export async function getReportDetail(actor: Actor, id: string) {
  let report;
  try {
    report = await findOpenableReport(actor, id);
  } catch {
    return null;
  }
  const [[summary], tasks] = await Promise.all([
    serialiseReports([report]),
    prisma.task.findMany({
      where: { weeklyReportId: id },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      include: { project: { select: { id: true, name: true, color: true } } },
    }),
  ]);
  const isOwner = report.userId === actor.id;
  const isApprover = report.currentApproverId === actor.id && isAwaitingReview(report.status);
  return {
    ...summary!,
    tasks: tasks.map((task) => ({
      id: task.id,
      date: dayString(task.date),
      details: task.details,
      hours: task.hours,
      status: task.status as TaskStatus,
      project: {
        id: task.project.id,
        name: task.project.name,
        color: task.project.color as PaletteColor,
      },
    })),
    permissions: {
      isOwner,
      canEdit: isOwner && isEditableStatus(report.status),
      canSubmit: isOwner && isEditableStatus(report.status) && report.taskCount > 0,
      canReview: isApprover,
    },
  };
}

export type ReportDetail = NonNullable<Awaited<ReturnType<typeof getReportDetail>>>;

type WorkflowUser = { id: string; name: string; role: Actor["role"]; reportsTo: string | null };

const WORKFLOW_USER = { id: true, name: true, role: true, reportsTo: true } as const;

const weekLabel = (report: { isoWeek: number }) => `week ${report.isoWeek}`;

/** Recorded on the trail when the Thursday job submits a week for its owner. */
export const AUTO_SUBMIT_COMMENT = "Submitted automatically at the Thursday 6 PM deadline.";

/**
 * Applies one workflow step. The update is conditioned on the state that was read, so two
 * approvers acting at once can't both succeed. `automatic` marks a submit made for the owner
 * by the Thursday job (see auto-submit.ts).
 */
export async function transitionReport(
  actor: Actor,
  id: string,
  action: WorkflowAction,
  comment?: string,
  { automatic = false }: { automatic?: boolean } = {},
) {
  const report = await findOpenableReport(actor, id);
  const [owner, actorUser, department, approval] = await Promise.all([
    prisma.user.findUnique({ where: { id: report.userId }, select: WORKFLOW_USER }),
    prisma.user.findUnique({ where: { id: actor.id }, select: WORKFLOW_USER }),
    prisma.department.findUnique({ where: { id: report.departmentId }, select: { managerId: true } }),
    getApprovalSettings(),
  ]);
  if (!owner || !actorUser) throw notFound();

  let transition;
  try {
    transition = nextTransition(
      { status: report.status, currentApproverId: report.currentApproverId },
      owner,
      actorUser,
      action,
      comment,
      { teamLeadReview: approval.teamLeadReview, departmentManagerId: department?.managerId ?? null },
    );
  } catch (error) {
    if (!(error instanceof WorkflowError)) throw error;
    if (error.code === "NOT_ALLOWED") throw forbidden(error.message);
    if (error.code === "INVALID_TRANSITION") throw conflict(error.message, error.code);
    throw badRequest(error.message, error.code);
  }
  if (action === "submit" && report.taskCount === 0) {
    throw badRequest("Add at least one task before submitting this week.", "EMPTY_REPORT");
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.weeklyReport.updateMany({
      where: { id, status: report.status, currentApproverId: report.currentApproverId },
      data: {
        status: transition.status,
        currentApproverId: transition.currentApproverId,
        ...(transition.timestamp ? { [transition.timestamp]: now } : {}),
      },
    });
    if (count === 0) return null;
    await tx.reportTrailEntry.create({
      data: {
        reportId: id,
        action: transition.trailAction,
        byUserId: actor.id,
        at: now,
        comment: action === "requestChanges" ? comment!.trim() : automatic ? AUTO_SUBMIT_COMMENT : null,
      },
    });
    await tx.task.updateMany({ where: { weeklyReportId: id }, data: { reportStatus: transition.status } });
    return tx.weeklyReport.findUniqueOrThrow({ where: { id }, include: REPORT_INCLUDE });
  });
  if (!updated) {
    throw conflict("Someone else changed this report just now. Reload to see its current state.");
  }
  await notifyTransition(updated, owner, actorUser, action, automatic);
  return updated;
}

/**
 * Who hears about each step, in the app and by email. A submitted week goes to the owner's
 * approver (a Developer's to their Team Lead, or to the Manager when Team Leads are exempt from
 * reviewing), a Team Lead's approval to the Manager, and a
 * Manager's final approval to the CEO. Sent-back reports go to their owner. The CEO is told in
 * the app only: `notify` never emails them.
 */
async function notifyTransition(
  report: ReportRecord,
  owner: WorkflowUser,
  actor: WorkflowUser,
  action: WorkflowAction,
  automatic = false,
) {
  const link = `/reports/${report.id}`;
  const base = { departmentId: report.departmentId, reportId: report.id, link };
  const week = weekLabel(report);

  if (action === "submit" && report.currentApproverId) {
    await notify({
      ...base,
      recipientId: report.currentApproverId,
      type: "REPORT_SUBMITTED",
      title: automatic ? `${owner.name}'s ${week} was submitted automatically` : `${owner.name} submitted ${week}`,
      message: automatic
        ? `${owner.name} hadn't submitted ${week} by Thursday 6 PM, so it was submitted automatically. It's waiting for your review.`
        : `${owner.name} submitted their report for ${week}. It's waiting for your review.`,
      email: true,
    });
    if (automatic) {
      await notify({
        ...base,
        recipientId: owner.id,
        type: "REPORT_SUBMITTED",
        title: `Your ${week} was submitted automatically`,
        message: `You hadn't submitted ${week} by Thursday 6 PM, so it was sent to your approver as it stood.`,
        email: true,
      });
    }
    return;
  }

  if (action === "requestChanges") {
    const comment = report.trail.at(-1)?.comment ?? "";
    await notify({
      ...base,
      recipientId: owner.id,
      type: "REPORT_CHANGES_REQUESTED",
      title: `Changes requested on ${week}`,
      message: `${actor.name} asked for changes to your ${week} report: "${comment}"`,
      email: true,
    });
    return;
  }

  if (report.status === "LEAD_APPROVED" && report.currentApproverId) {
    await notify({
      ...base,
      recipientId: report.currentApproverId,
      type: "REPORT_SUBMITTED",
      title: `${owner.name}'s ${week} is ready for you`,
      message: `${actor.name} approved ${owner.name}'s report for ${week}. It's waiting for your review.`,
      email: true,
    });
    return;
  }

  if (report.status === "MANAGER_APPROVED") {
    if (owner.role === "MANAGER") {
      // The CEO acknowledged a Manager's report, so the Manager is told in the app.
      await notify({
        ...base,
        recipientId: owner.id,
        type: "REPORT_ACKNOWLEDGED",
        title: `The CEO acknowledged your ${week}`,
        message: `${actor.name} acknowledged your report for ${week}.`,
      });
      return;
    }
    const ceo = await prisma.user.findFirst({ where: { role: "CEO", isActive: true }, select: { id: true } });
    if (!ceo) return;
    await notify({
      ...base,
      recipientId: ceo.id,
      type: "REPORT_APPROVED",
      title: `${owner.name}'s ${week} is approved`,
      message: `${actor.name} (${ROLE_LABELS[actor.role]}) gave final approval to ${owner.name}'s report for ${week}.`,
      email: true,
    });
  }
}
