import { addDays, format, subDays } from "date-fns";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { ROLE_LABELS, seesAllDepartments, type PaletteColor, type ReportStatus, type SyncOrigin, type TaskSource, type TaskStatus } from "@/lib/constants";
import { isUniqueViolation, prisma } from "@/lib/db/prisma";
import { projectScope, type Actor } from "@/lib/permissions";
import { dayString, isoWeekOfDay, localDay, storedDay, todayString } from "@/lib/reports/iso-week";
import { recomputeTotals, REPORT_INCLUDE, serialiseReports } from "@/lib/reports/service";
import { isEditableStatus } from "@/lib/reports/workflow";
import type { CreateTaskInput, UpdateTaskInput } from "@/validators/task";

const COPY_LOOKBACK_DAYS = 14;
const MAX_TEMPLATES = 50;

/** Only people in a department log work. The CEO and the Super Admin don't keep a log. */
export function requireLogger(actor: Actor) {
  if (seesAllDepartments(actor.role)) throw forbidden(`The ${ROLE_LABELS[actor.role]} doesn't log tasks.`);
  if (!actor.departmentId) throw forbidden("You need a department before you can log work.");
  return actor.departmentId;
}

/**
 * The project, if this person may log work on it: in their department, not completed, and for
 * developers, assigned to them. Anything else gets one message, which reveals nothing.
 */
async function requireLoggableProject(actor: Actor, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...projectScope(actor), status: { not: "Completed" } },
    select: { id: true },
  });
  if (!project) {
    throw badRequest("You can only log work on active projects you're assigned to.", "PROJECT_NOT_ALLOWED");
  }
  return project.id;
}

function assertNotFuture(day: string) {
  // One day of slack, so someone a timezone ahead of the server isn't refused.
  if (day > format(addDays(localDay(todayString()), 1), "yyyy-MM-dd")) {
    throw badRequest("You can't log work for a future date.");
  }
}

/** The week's report, created as a draft on first use. */
async function weekReport(actor: Actor, departmentId: string, day: string) {
  const week = isoWeekOfDay(day);
  const key = { userId: actor.id, isoYear: week.isoYear, isoWeek: week.isoWeek };
  const select = { id: true, status: true } as const;
  const existing = await prisma.weeklyReport.findUnique({ where: { userId_isoYear_isoWeek: key }, select });
  if (existing) return existing;
  try {
    return await prisma.weeklyReport.create({
      data: { ...key, departmentId, weekStart: week.weekStart, weekEnd: week.weekEnd, status: "DRAFT" },
      select,
    });
  } catch (error) {
    // Two first tasks of a week can race on the insert. The loser reads the winner's report.
    if (!isUniqueViolation(error)) throw error;
    return prisma.weeklyReport.findUniqueOrThrow({ where: { userId_isoYear_isoWeek: key }, select });
  }
}

function assertEditable(report: { status: ReportStatus } | null) {
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

  const task = await prisma.task.create({
    data: {
      userId: actor.id,
      departmentId,
      projectId,
      date: storedDay(input.date),
      details: input.details,
      hours: input.hours,
      status: input.status,
      weeklyReportId: report.id,
      reportStatus: report.status,
      source: origin.source,
      syncHash: origin.syncHash,
      syncedFrom: origin.syncedFrom,
    },
  });
  await recomputeTotals(report.id);
  return task;
}

/** Someone else's task is a 404, whoever is asking. */
async function requireOwnEditableTask(actor: Actor, id: string) {
  const task = await prisma.task.findFirst({
    where: { id, userId: actor.id },
    include: { weeklyReport: { select: { status: true } } },
  });
  if (!task) throw notFound();
  assertEditable(task.weeklyReport);
  return task;
}

export async function updateTask(actor: Actor, id: string, patch: UpdateTaskInput) {
  const departmentId = requireLogger(actor);
  const task = await requireOwnEditableTask(actor, id);
  const previousReportId = task.weeklyReportId;

  const data: {
    projectId?: string;
    date?: Date;
    weeklyReportId?: string;
    reportStatus?: ReportStatus;
    details?: string;
    hours?: number | null;
    status?: string;
  } = {};
  if (patch.projectId) data.projectId = await requireLoggableProject(actor, patch.projectId);
  if (patch.date && patch.date !== dayString(task.date)) {
    assertNotFuture(patch.date);
    const report = await weekReport(actor, departmentId, patch.date);
    assertEditable(report);
    data.date = storedDay(patch.date);
    data.weeklyReportId = report.id;
    data.reportStatus = report.status;
  }
  if (patch.details !== undefined) data.details = patch.details;
  if (patch.hours !== undefined) data.hours = patch.hours;
  if (patch.status !== undefined) data.status = patch.status;
  const updated = await prisma.task.update({ where: { id }, data });

  await recomputeTotals(updated.weeklyReportId);
  if (previousReportId !== updated.weeklyReportId) await recomputeTotals(previousReportId);
  return updated;
}

export async function deleteTask(actor: Actor, id: string) {
  requireLogger(actor);
  const task = await requireOwnEditableTask(actor, id);
  await prisma.task.delete({ where: { id } });
  await recomputeTotals(task.weeklyReportId);
}

/** The caller's own tasks in a date range, with the reports of the weeks they fall in. */
export async function listMyTasks(actor: Actor, from: string, to: string) {
  const [tasks, reports] = await Promise.all([
    prisma.task.findMany({
      where: { userId: actor.id, date: { gte: storedDay(from), lte: storedDay(to) } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      include: { project: { select: { id: true, name: true, code: true, color: true } } },
    }),
    prisma.weeklyReport.findMany({
      where: { userId: actor.id, weekStart: { lte: storedDay(to) }, weekEnd: { gte: storedDay(from) } },
      include: REPORT_INCLUDE,
    }),
  ]);
  return {
    tasks: tasks.map((task) => ({
      id: task.id,
      date: dayString(task.date),
      details: task.details,
      hours: task.hours,
      status: task.status as TaskStatus,
      source: task.source,
      reportId: task.weeklyReportId,
      project: {
        id: task.project.id,
        name: task.project.name,
        code: task.project.code,
        color: task.project.color as PaletteColor,
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
  const userId = actor.id;
  const latest = await prisma.task.findFirst({
    where: {
      userId,
      date: {
        lt: storedDay(day),
        gte: storedDay(format(subDays(localDay(day), COPY_LOOKBACK_DAYS), "yyyy-MM-dd")),
      },
    },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) throw badRequest("There are no tasks in the two weeks before this day to copy.", "NOTHING_TO_COPY");

  const report = await weekReport(actor, departmentId, day);
  assertEditable(report);
  const source = await prisma.task.findMany({ where: { userId, date: latest.date }, orderBy: { createdAt: "asc" } });
  const allowed = new Set(
    (
      await prisma.project.findMany({
        where: {
          id: { in: source.map((task) => task.projectId) },
          ...projectScope(actor),
          status: { not: "Completed" },
        },
        select: { id: true },
      })
    ).map((project) => project.id),
  );
  const copies = source
    .filter((task) => allowed.has(task.projectId))
    .map((task) => ({
      userId,
      departmentId,
      projectId: task.projectId,
      date: storedDay(day),
      details: task.details,
      hours: task.hours,
      status: task.status,
      weeklyReportId: report.id,
      reportStatus: report.status,
    }));
  if (copies.length > 0) {
    await prisma.task.createMany({ data: copies });
    await recomputeTotals(report.id);
  }
  return { copied: copies.length, skipped: source.length - copies.length, from: dayString(latest.date) };
}

export async function listTemplates(actor: Actor) {
  const templates = await prisma.taskTemplate.findMany({
    where: { userId: actor.id },
    orderBy: { createdAt: "desc" },
    include: { project: { select: { id: true, name: true, color: true } } },
  });
  return templates.map((template) => ({
    id: template.id,
    details: template.details,
    hours: template.hours,
    project: {
      id: template.project.id,
      name: template.project.name,
      color: template.project.color as PaletteColor,
    },
  }));
}

export async function createTemplate(
  actor: Actor,
  input: { projectId: string; details: string; hours: number | null },
) {
  const departmentId = requireLogger(actor);
  const projectId = await requireLoggableProject(actor, input.projectId);
  if ((await prisma.taskTemplate.count({ where: { userId: actor.id } })) >= MAX_TEMPLATES) {
    throw conflict(`You can keep up to ${MAX_TEMPLATES} templates. Delete one first.`);
  }
  return prisma.taskTemplate.create({
    data: { details: input.details, hours: input.hours, projectId, departmentId, userId: actor.id },
  });
}

export async function deleteTemplate(actor: Actor, id: string) {
  const { count } = await prisma.taskTemplate.deleteMany({ where: { id, userId: actor.id } });
  if (count === 0) throw notFound();
}
