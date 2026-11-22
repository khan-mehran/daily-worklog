import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { forbidden, notFound } from "@/lib/api/errors";
import { REPORT_STATUS_LABELS, REPORT_STATUSES, ROLE_LABELS } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { scopeFor, type Actor } from "@/lib/permissions";
import { dayString, storedDay } from "@/lib/reports/iso-week";
import { visibleTasksFilter } from "@/lib/reports/visibility";
import { daySchema, idSchema } from "@/validators/common";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const EXPORT_BATCH = 500;
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } } as const;

export const exportQuerySchema = z
  .object({
    from: daySchema,
    to: daySchema,
    userIds: z
      .string()
      .optional()
      .transform((value) => (value ? value.split(",").filter(Boolean) : []))
      .pipe(z.array(idSchema).max(200)),
    projectId: idSchema.optional(),
    status: z.enum(REPORT_STATUSES).optional(),
    departmentId: idSchema.optional(),
  })
  .refine((value) => value.from <= value.to, { path: ["to"], message: "The range ends before it starts" });

type ExportQuery = z.output<typeof exportQuerySchema>;

const styleHeader = (row: ExcelJS.Row) => {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
};

/**
 * Streams an .xlsx of the tasks this person may see: their department only (the CEO may pick
 * one or all), and only work past their approval gate. Filters narrow it further, never widen.
 */
export async function exportTasks(actor: Actor, selectedDepartmentId: string | null, query: ExportQuery) {
  if (actor.role === "DEVELOPER") throw forbidden("Exports are for Team Leads, Managers and the CEO.");

  const where: Prisma.TaskWhereInput = {
    AND: [
      await visibleTasksFilter(actor),
      {
        ...scopeFor(actor, query.departmentId ?? selectedDepartmentId),
        date: { gte: storedDay(query.from), lte: storedDay(query.to) },
        ...(query.userIds.length ? { userId: { in: query.userIds } } : {}),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.status ? { reportStatus: query.status } : {}),
      },
    ],
  };

  // Totals for the summary sheet, and with them the people and projects in this export.
  const totals = { _sum: { hours: true }, _count: { _all: true } } as const;
  const [projectTotals, personTotals] = await Promise.all([
    prisma.task.groupBy({ by: ["projectId"], where, ...totals }),
    prisma.task.groupBy({ by: ["userId"], where, ...totals }),
  ]);
  const [users, projects] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: personTotals.map((row) => row.userId) } },
      select: { id: true, name: true, role: true },
    }),
    prisma.project.findMany({
      where: { id: { in: projectTotals.map((row) => row.projectId) } },
      select: { id: true, name: true },
    }),
  ]);
  const departments = await prisma.department.findMany({ select: { id: true, name: true } });
  const userById = new Map(users.map((user) => [user.id, user]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const departmentById = new Map(departments.map((department) => [department.id, department.name]));

  const summaryRows = <T extends { _sum: { hours: number | null }; _count: { _all: number } }>(
    rows: T[],
    name: (row: T) => string,
  ) =>
    rows
      .map((row) => ({ name: name(row), hours: row._sum.hours ?? 0, tasks: row._count._all }))
      .sort((a, b) => b.hours - a.hours);
  const byProject = summaryRows(projectTotals, (row) => projectById.get(row.projectId)?.name ?? "");
  const byPerson = summaryRows(personTotals, (row) => userById.get(row.userId)?.name ?? "");

  const output = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true });

  // Rows are read and written in batches, so a large export never sits in memory.
  void (async () => {
    try {
      const sheet = workbook.addWorksheet("Tasks", { views: [{ state: "frozen", ySplit: 1 }] });
      sheet.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Employee", key: "employee", width: 24 },
        { header: "Role", key: "role", width: 12 },
        { header: "Department", key: "department", width: 16 },
        { header: "Project", key: "project", width: 24 },
        { header: "Task details", key: "details", width: 70 },
        { header: "Hours", key: "hours", width: 8 },
        { header: "Status", key: "status", width: 12 },
        { header: "Report status", key: "reportStatus", width: 18 },
      ];
      styleHeader(sheet.getRow(1));
      sheet.getRow(1).commit();

      let cursor: string | undefined;
      for (;;) {
        const tasks = await prisma.task.findMany({
          where,
          orderBy: [{ date: "asc" }, { userId: "asc" }, { id: "asc" }],
          take: EXPORT_BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const task of tasks) {
          const user = userById.get(task.userId);
          sheet
            .addRow({
              date: dayString(task.date),
              employee: user?.name ?? "",
              role: user ? ROLE_LABELS[user.role] : "",
              department: departmentById.get(task.departmentId) ?? "",
              project: projectById.get(task.projectId)?.name ?? "",
              details: task.details,
              hours: task.hours,
              status: task.status,
              reportStatus: REPORT_STATUS_LABELS[task.reportStatus],
            })
            .commit();
        }
        if (tasks.length < EXPORT_BATCH) break;
        cursor = tasks.at(-1)!.id;
      }
      sheet.commit();

      const summary = workbook.addWorksheet("Summary");
      summary.columns = [
        { key: "name", width: 30 },
        { key: "hours", width: 10 },
        { key: "tasks", width: 10 },
      ];
      const section = (title: string, rows: { name: string; hours: number; tasks: number }[]) => {
        summary.addRow([title]).font = { bold: true, size: 13 };
        styleHeader(summary.addRow(["Name", "Hours", "Tasks"]));
        for (const row of rows) summary.addRow([row.name, row.hours, row.tasks]);
        summary.addRow([]);
      };
      summary.addRow([`GET List export, ${query.from} to ${query.to}`]).font = { bold: true, size: 14 };
      summary.addRow([]);
      section("Hours per project", byProject);
      section("Hours per person", byPerson);
      summary.commit();
      await workbook.commit();
    } catch (error) {
      console.error("[export] failed while writing", error);
      output.destroy(error as Error);
    }
  })();

  return new Response(Readable.toWeb(output) as ReadableStream, {
    headers: {
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename="getl-tasks-${query.from}-to-${query.to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

/** One weekly report as .xlsx, for its owner only. Anyone else gets a 404. */
export async function exportWeeklyReport(actor: Actor & { name: string }, id: string) {
  const report = await prisma.weeklyReport.findFirst({ where: { id, userId: actor.id } });
  if (!report) throw notFound();
  const tasks = await prisma.task.findMany({
    where: { weeklyReportId: id },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: { project: { select: { name: true } } },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Week ${report.isoWeek}`);
  sheet.columns = [
    { key: "date", width: 12 },
    { key: "project", width: 24 },
    { key: "details", width: 70 },
    { key: "hours", width: 8 },
    { key: "status", width: 12 },
  ];
  sheet.addRow([`${actor.name}: week ${report.isoWeek}, ${dayString(report.weekStart)} to ${dayString(report.weekEnd)}`]).font = {
    bold: true,
    size: 14,
  };
  sheet.addRow([`Status: ${REPORT_STATUS_LABELS[report.status]}`, "", `Total hours: ${report.totalHours}`]);
  sheet.addRow([]);
  styleHeader(sheet.addRow(["Date", "Project", "Task details", "Hours", "Status"]));
  for (const task of tasks) {
    sheet.addRow([dayString(task.date), task.project.name, task.details, task.hours, task.status]);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename="getl-week-${report.isoYear}-${report.isoWeek}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
