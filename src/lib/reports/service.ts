import { Types } from "mongoose";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { ROLE_LABELS, type ReportStatus } from "@/lib/constants";
import { notify } from "@/lib/notifications";
import { scopeFor, type Actor } from "@/lib/permissions";
import { Project, Task, User, WeeklyReport, type IWeeklyReport } from "@/models";
import { dayString } from "./iso-week";
import { openableReportsFilter } from "./visibility";
import {
  isAwaitingReview,
  isEditableStatus,
  nextTransition,
  WorkflowError,
  type WorkflowAction,
} from "./workflow";

/** Rebuilds a report's cached totals from its tasks, in one aggregation. */
export async function recomputeTotals(reportId: Types.ObjectId) {
  const rows = await Task.aggregate<{
    _id: Types.ObjectId;
    hours: number;
    taskCount: number;
    completedCount: number;
    blockedCount: number;
  }>([
    { $match: { weeklyReportId: reportId } },
    {
      $group: {
        _id: "$projectId",
        hours: { $sum: { $ifNull: ["$hours", 0] } },
        taskCount: { $sum: 1 },
        completedCount: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
        blockedCount: { $sum: { $cond: [{ $eq: ["$status", "Blocked"] }, 1, 0] } },
      },
    },
  ]);
  const sum = (key: "hours" | "taskCount" | "completedCount" | "blockedCount") =>
    rows.reduce((total, row) => total + row[key], 0);
  await WeeklyReport.updateOne(
    { _id: reportId },
    {
      totals: {
        hours: sum("hours"),
        taskCount: sum("taskCount"),
        completedCount: sum("completedCount"),
        blockedCount: sum("blockedCount"),
        byProject: rows.map((row) => ({
          projectId: row._id,
          hours: row.hours,
          taskCount: row.taskCount,
        })),
      },
    },
  );
}

type LeanReport = IWeeklyReport;

/** Turns reports into API objects, with project and people names in two queries in total. */
export async function serialiseReports(reports: LeanReport[]) {
  const projectIds = [
    ...new Set(reports.flatMap((report) => report.totals.byProject.map((row) => String(row.projectId)))),
  ];
  const personIds = [
    ...new Set(
      reports.flatMap((report) => [
        String(report.userId),
        ...report.approvalTrail.map((entry) => String(entry.byUserId)),
        ...(report.currentApproverId ? [String(report.currentApproverId)] : []),
      ]),
    ),
  ];
  const [projects, people] = await Promise.all([
    Project.find({ _id: { $in: projectIds } }).select("name code color").lean(),
    User.find({ _id: { $in: personIds } }).select("name role avatarColor").lean(),
  ]);
  const projectById = new Map(projects.map((project) => [String(project._id), project]));
  const personById = new Map(people.map((person) => [String(person._id), person]));
  const person = (id: Types.ObjectId | null) => {
    const found = id ? personById.get(String(id)) : undefined;
    return found
      ? { id: String(found._id), name: found.name, role: found.role, avatarColor: found.avatarColor }
      : null;
  };

  return reports.map((report) => ({
    id: String(report._id),
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
      hours: report.totals.hours,
      taskCount: report.totals.taskCount,
      completedCount: report.totals.completedCount,
      blockedCount: report.totals.blockedCount,
      byProject: report.totals.byProject
        .map((row) => {
          const project = projectById.get(String(row.projectId));
          return {
            projectId: String(row.projectId),
            name: project?.name ?? "Deleted project",
            color: project?.color ?? "slate",
            hours: row.hours,
            taskCount: row.taskCount,
          };
        })
        .sort((a, b) => b.hours - a.hours),
    },
    trail: report.approvalTrail.map((entry) => ({
      action: entry.action,
      by: person(entry.byUserId),
      at: entry.at.toISOString(),
      comment: entry.comment,
    })),
  }));
}

export type ReportSummary = Awaited<ReturnType<typeof serialiseReports>>[number];

export async function listMyReports(actor: Actor, page: number, limit: number) {
  const filter = { userId: new Types.ObjectId(actor.id) };
  const [reports, total] = await Promise.all([
    WeeklyReport.find(filter)
      .sort({ weekStart: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    WeeklyReport.countDocuments(filter),
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
  const filter = {
    ...scopeFor(actor, selectedDepartmentId),
    currentApproverId: new Types.ObjectId(actor.id),
    status: { $in: ["SUBMITTED", "LEAD_APPROVED"] satisfies ReportStatus[] },
  };
  const [reports, total] = await Promise.all([
    WeeklyReport.find(filter)
      .sort({ submittedAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    WeeklyReport.countDocuments(filter),
  ]);
  return { reports: await serialiseReports(reports), total };
}

async function findOpenableReport(actor: Actor, id: Types.ObjectId) {
  const report = await WeeklyReport.findOne({ _id: id, ...(await openableReportsFilter(actor)) }).lean();
  if (!report) throw notFound();
  return report;
}

/** A report with its tasks, for its owner, its approvers and those it has reached. */
export async function getReportDetail(actor: Actor, id: Types.ObjectId) {
  let report;
  try {
    report = await findOpenableReport(actor, id);
  } catch {
    return null;
  }
  const [[summary], tasks] = await Promise.all([
    serialiseReports([report]),
    Task.find({ weeklyReportId: id })
      .sort({ date: 1, createdAt: 1 })
      .populate<{ projectId: { _id: Types.ObjectId; name: string; color: string } }>(
        "projectId",
        "name color",
      )
      .lean(),
  ]);
  const isOwner = String(report.userId) === actor.id;
  const isApprover = String(report.currentApproverId) === actor.id && isAwaitingReview(report.status);
  return {
    ...summary!,
    tasks: tasks.map((task) => ({
      id: String(task._id),
      date: dayString(task.date),
      details: task.details,
      hours: task.hours,
      status: task.status,
      project: {
        id: String(task.projectId._id),
        name: task.projectId.name,
        color: task.projectId.color,
      },
    })),
    permissions: {
      isOwner,
      canEdit: isOwner && isEditableStatus(report.status),
      canSubmit: isOwner && isEditableStatus(report.status) && report.totals.taskCount > 0,
      canReview: isApprover,
    },
  };
}

export type ReportDetail = NonNullable<Awaited<ReturnType<typeof getReportDetail>>>;

const workflowPerson = (user: { _id: Types.ObjectId; role: Actor["role"]; reportsTo: Types.ObjectId | null }) => ({
  id: String(user._id),
  role: user.role,
  reportsTo: user.reportsTo ? String(user.reportsTo) : null,
});

const weekLabel = (report: { isoWeek: number }) => `week ${report.isoWeek}`;

/**
 * Applies one workflow step. The update is conditioned on the state that was read, so two
 * approvers acting at once can't both succeed.
 */
export async function transitionReport(
  actor: Actor,
  id: Types.ObjectId,
  action: WorkflowAction,
  comment?: string,
) {
  const report = await findOpenableReport(actor, id);
  const [owner, actorUser] = await Promise.all([
    User.findById(report.userId).select("name role reportsTo").lean(),
    User.findById(actor.id).select("name role reportsTo").lean(),
  ]);
  if (!owner || !actorUser) throw notFound();

  let transition;
  try {
    transition = nextTransition(
      {
        status: report.status,
        currentApproverId: report.currentApproverId ? String(report.currentApproverId) : null,
      },
      workflowPerson(owner),
      workflowPerson(actorUser),
      action,
      comment,
    );
  } catch (error) {
    if (!(error instanceof WorkflowError)) throw error;
    if (error.code === "NOT_ALLOWED") throw forbidden(error.message);
    if (error.code === "INVALID_TRANSITION") throw conflict(error.message, error.code);
    throw badRequest(error.message, error.code);
  }
  if (action === "submit" && report.totals.taskCount === 0) {
    throw badRequest("Add at least one task before submitting this week.", "EMPTY_REPORT");
  }

  const now = new Date();
  const updated = await WeeklyReport.findOneAndUpdate(
    { _id: id, status: report.status, currentApproverId: report.currentApproverId },
    {
      $set: {
        status: transition.status,
        currentApproverId: transition.currentApproverId
          ? new Types.ObjectId(transition.currentApproverId)
          : null,
        ...(transition.timestamp ? { [transition.timestamp]: now } : {}),
      },
      $push: {
        approvalTrail: {
          action: transition.trailAction,
          byUserId: new Types.ObjectId(actor.id),
          at: now,
          comment: action === "requestChanges" ? comment!.trim() : null,
        },
      },
    },
    { new: true },
  ).lean();
  if (!updated) {
    throw conflict("Someone else changed this report just now. Reload to see its current state.");
  }
  await Task.updateMany({ weeklyReportId: id }, { reportStatus: transition.status });
  await notifyTransition(updated, owner, actorUser, action);
  return updated;
}

/**
 * Who hears about each step. An approval goes only to the next level up: a Team Lead's approval
 * to the Manager, a Manager's final approval to the CEO. Sent-back reports go to their owner.
 */
async function notifyTransition(
  report: LeanReport,
  owner: { _id: Types.ObjectId; name: string; role: Actor["role"] },
  actor: { _id: Types.ObjectId; name: string; role: Actor["role"] },
  action: WorkflowAction,
) {
  const link = `/reports/${report._id}`;
  const base = { departmentId: report.departmentId, reportId: report._id, link };
  const week = weekLabel(report);

  if (action === "submit" && report.currentApproverId) {
    await notify({
      ...base,
      recipientId: report.currentApproverId,
      type: "REPORT_SUBMITTED",
      title: `${owner.name} submitted ${week}`,
      message: `${owner.name} submitted their report for ${week}. It's waiting for your review.`,
      email: true,
    });
    return;
  }

  if (action === "requestChanges") {
    const comment = report.approvalTrail.at(-1)?.comment ?? "";
    await notify({
      ...base,
      recipientId: owner._id,
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
        recipientId: owner._id,
        type: "REPORT_ACKNOWLEDGED",
        title: `The CEO acknowledged your ${week}`,
        message: `${actor.name} acknowledged your report for ${week}.`,
      });
      return;
    }
    const ceo = await User.findOne({ role: "CEO", isActive: true }).select("_id").lean();
    if (!ceo) return;
    await notify({
      ...base,
      recipientId: ceo._id,
      type: "REPORT_APPROVED",
      title: `${owner.name}'s ${week} is approved`,
      message: `${actor.name} (${ROLE_LABELS[actor.role]}) gave final approval to ${owner.name}'s report for ${week}.`,
      email: true,
    });
  }
}
