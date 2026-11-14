import { addDays, format, subDays } from "date-fns";
import { Types } from "mongoose";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { projectScope, type Actor } from "@/lib/permissions";
import {
  dayString,
  isoWeekOfDay,
  localDay,
  storedDay,
  todayString,
} from "@/lib/reports/iso-week";
import { recomputeTotals, serialiseReports } from "@/lib/reports/service";
import { isEditableStatus } from "@/lib/reports/workflow";
import { Project, Task, TaskTemplate, WeeklyReport } from "@/models";
import type { SyncOrigin, TaskSource } from "@/lib/constants";
import type { CreateTaskInput, UpdateTaskInput } from "@/validators/task";

const COPY_LOOKBACK_DAYS = 14;
const MAX_TEMPLATES = 50;

/** Only people in a department log work. The CEO reviews and doesn't keep a log. */
export function requireLogger(actor: Actor) {
  if (actor.role === "CEO") throw forbidden("The CEO doesn't log tasks.");
  if (!actor.departmentId) throw forbidden("You need a department before you can log work.");
  return new Types.ObjectId(actor.departmentId);
}

/**
 * The project, if this person may log work on it: in their department, not completed, and for
 * developers, assigned to them. Anything else gets one message, which reveals nothing.
 */
async function requireLoggableProject(actor: Actor, projectId: string) {
  const project = await Project.findOne({
    _id: projectId,
    ...projectScope(actor),
    status: { $ne: "Completed" },
  })
    .select("_id")
    .lean();
  if (!project) {
    throw badRequest("You can only log work on active projects you're assigned to.", "PROJECT_NOT_ALLOWED");
  }
  return project._id;
}

function assertNotFuture(day: string) {
  // One day of slack, so someone a timezone ahead of the server isn't refused.
  if (day > format(addDays(localDay(todayString()), 1), "yyyy-MM-dd")) {
    throw badRequest("You can't log work for a future date.");
  }
}

/** The week's report, created as a draft on first use. */
async function weekReport(actor: Actor, departmentId: Types.ObjectId, day: string) {
  const week = isoWeekOfDay(day);
  const userId = new Types.ObjectId(actor.id);
  try {
    return await WeeklyReport.findOneAndUpdate(
      { userId, isoYear: week.isoYear, isoWeek: week.isoWeek },
      { $setOnInsert: { departmentId, weekStart: week.weekStart, weekEnd: week.weekEnd, status: "DRAFT" } },
      { upsert: true, new: true },
    ).lean();
  } catch (error) {
    // Two first tasks of a week can race on the upsert. The loser reads the winner's report.
    if ((error as { code?: number }).code !== 11000) throw error;
    return WeeklyReport.findOne({ userId, isoYear: week.isoYear, isoWeek: week.isoWeek }).lean();
  }
}

function assertEditable(report: { status: Parameters<typeof isEditableStatus>[0] } | null) {
  if (!report || !isEditableStatus(report.status)) {
    throw conflict(
      "This week has been submitted, so its tasks are locked. They unlock if changes are requested.",
      "REPORT_LOCKED",
    );
  }
}

export async function createTask(
  actor: Actor,
  input: CreateTaskInput,
  origin: { source: TaskSource; syncHash: string | null; syncedFrom: SyncOrigin | null } = {
    source: "manual",
    syncHash: null,
    syncedFrom: null,
  },
) {
  const departmentId = requireLogger(actor);
  assertNotFuture(input.date);
  const projectId = await requireLoggableProject(actor, input.projectId);
  const report = await weekReport(actor, departmentId, input.date);
  assertEditable(report);

  const task = await Task.create({
    userId: actor.id,
    departmentId,
    projectId,
    date: storedDay(input.date),
    details: input.details,
    hours: input.hours,
    status: input.status,
    weeklyReportId: report!._id,
    reportStatus: report!.status,
    source: origin.source,
    syncHash: origin.syncHash,
    syncedFrom: origin.syncedFrom,
  });
  await recomputeTotals(report!._id);
  return task;
}

/** Someone else's task is a 404, whoever is asking. */
async function requireOwnEditableTask(actor: Actor, id: Types.ObjectId) {
  const task = await Task.findOne({ _id: id, userId: new Types.ObjectId(actor.id) });
  if (!task) throw notFound();
  assertEditable(await WeeklyReport.findById(task.weeklyReportId).select("status").lean());
  return task;
}

export async function updateTask(actor: Actor, id: Types.ObjectId, patch: UpdateTaskInput) {
  const departmentId = requireLogger(actor);
  const task = await requireOwnEditableTask(actor, id);
  const previousReportId = task.weeklyReportId;

  if (patch.projectId) task.projectId = await requireLoggableProject(actor, patch.projectId);
  if (patch.date && patch.date !== dayString(task.date)) {
    assertNotFuture(patch.date);
    const report = await weekReport(actor, departmentId, patch.date);
    assertEditable(report);
    task.date = storedDay(patch.date);
    task.weeklyReportId = report!._id;
    task.reportStatus = report!.status;
  }
  if (patch.details !== undefined) task.details = patch.details;
  if (patch.hours !== undefined) task.hours = patch.hours;
  if (patch.status !== undefined) task.status = patch.status;
  await task.save();

  await recomputeTotals(task.weeklyReportId);
  if (String(previousReportId) !== String(task.weeklyReportId)) await recomputeTotals(previousReportId);
  return task;
}

export async function deleteTask(actor: Actor, id: Types.ObjectId) {
  requireLogger(actor);
  const task = await requireOwnEditableTask(actor, id);
  await task.deleteOne();
  await recomputeTotals(task.weeklyReportId);
}

/** The caller's own tasks in a date range, with the reports of the weeks they fall in. */
export async function listMyTasks(actor: Actor, from: string, to: string) {
  const userId = new Types.ObjectId(actor.id);
  const [tasks, reports] = await Promise.all([
    Task.find({ userId, date: { $gte: storedDay(from), $lte: storedDay(to) } })
      .sort({ date: 1, createdAt: 1 })
      .populate<{ projectId: { _id: Types.ObjectId; name: string; code: string; color: string } }>(
        "projectId",
        "name code color",
      )
      .lean(),
    WeeklyReport.find({
      userId,
      weekStart: { $lte: storedDay(to) },
      weekEnd: { $gte: storedDay(from) },
    }).lean(),
  ]);
  return {
    tasks: tasks.map((task) => ({
      id: String(task._id),
      date: dayString(task.date),
      details: task.details,
      hours: task.hours,
      status: task.status,
      source: task.source ?? "manual",
      reportId: String(task.weeklyReportId),
      project: {
        id: String(task.projectId._id),
        name: task.projectId.name,
        code: task.projectId.code,
        color: task.projectId.color,
      },
    })),
    reports: await serialiseReports(reports),
  };
}

export type MyTask = Awaited<ReturnType<typeof listMyTasks>>["tasks"][number];

/**
 * Copies the most recent earlier day's tasks (within two weeks) onto `day`. Projects the person
 * can no longer log against are skipped, and the result says how many.
 */
export async function copyPreviousDay(actor: Actor, day: string) {
  const departmentId = requireLogger(actor);
  assertNotFuture(day);
  const userId = new Types.ObjectId(actor.id);
  const latest = await Task.findOne({
    userId,
    date: { $lt: storedDay(day), $gte: storedDay(format(subDays(localDay(day), COPY_LOOKBACK_DAYS), "yyyy-MM-dd")) },
  })
    .sort({ date: -1 })
    .select("date")
    .lean();
  if (!latest) throw badRequest("There are no tasks in the two weeks before this day to copy.", "NOTHING_TO_COPY");

  const report = await weekReport(actor, departmentId, day);
  assertEditable(report);
  const source = await Task.find({ userId, date: latest.date }).sort({ createdAt: 1 }).lean();
  const allowed = new Set(
    (
      await Project.find({
        _id: { $in: source.map((task) => task.projectId) },
        ...projectScope(actor),
        status: { $ne: "Completed" },
      }).distinct("_id")
    ).map(String),
  );
  const copies = source
    .filter((task) => allowed.has(String(task.projectId)))
    .map((task) => ({
      userId,
      departmentId,
      projectId: task.projectId,
      date: storedDay(day),
      details: task.details,
      hours: task.hours,
      status: task.status,
      weeklyReportId: report!._id,
      reportStatus: report!.status,
    }));
  if (copies.length > 0) {
    await Task.insertMany(copies);
    await recomputeTotals(report!._id);
  }
  return { copied: copies.length, skipped: source.length - copies.length, from: dayString(latest.date) };
}

export async function listTemplates(actor: Actor) {
  const templates = await TaskTemplate.find({ userId: new Types.ObjectId(actor.id) })
    .sort({ createdAt: -1 })
    .populate<{ projectId: { _id: Types.ObjectId; name: string; color: string } }>("projectId", "name color")
    .lean();
  return templates
    .filter((template) => template.projectId)
    .map((template) => ({
      id: String(template._id),
      details: template.details,
      hours: template.hours,
      project: {
        id: String(template.projectId._id),
        name: template.projectId.name,
        color: template.projectId.color,
      },
    }));
}

export async function createTemplate(
  actor: Actor,
  input: { projectId: string; details: string; hours: number | null },
) {
  const departmentId = requireLogger(actor);
  const projectId = await requireLoggableProject(actor, input.projectId);
  if ((await TaskTemplate.countDocuments({ userId: actor.id })) >= MAX_TEMPLATES) {
    throw conflict(`You can keep up to ${MAX_TEMPLATES} templates. Delete one first.`);
  }
  return TaskTemplate.create({ ...input, projectId, departmentId, userId: actor.id });
}

export async function deleteTemplate(actor: Actor, id: Types.ObjectId) {
  const deleted = await TaskTemplate.findOneAndDelete({ _id: id, userId: new Types.ObjectId(actor.id) });
  if (!deleted) throw notFound();
}
