import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import { Types, type FilterQuery } from "mongoose";
import { z } from "zod";
import { forbidden, notFound } from "@/lib/api/errors";
import { REPORT_STATUS_LABELS, REPORT_STATUSES, ROLE_LABELS, type ReportStatus, type Role } from "@/lib/constants";
import { scopeFor, type Actor } from "@/lib/permissions";
import { dayString, storedDay } from "@/lib/reports/iso-week";
import { visibleTasksFilter } from "@/lib/reports/visibility";
import { Department, Project, Task, User, WeeklyReport, type ITask } from "@/models";
import { daySchema, objectIdSchema } from "@/validators/common";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } } as const;

export const exportQuerySchema = z
  .object({
    from: daySchema,
    to: daySchema,
    userIds: z
      .string()
      .optional()
      .transform((value) => (value ? value.split(",").filter(Boolean) : []))
      .pipe(z.array(objectIdSchema).max(200)),
    projectId: objectIdSchema.optional(),
    status: z.enum(REPORT_STATUSES).optional(),
    departmentId: objectIdSchema.optional(),
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

  const filter: FilterQuery<ITask> = {
    $and: [
      await visibleTasksFilter(actor),
      {
        ...scopeFor(actor, query.departmentId ?? selectedDepartmentId),
        date: { $gte: storedDay(query.from), $lte: storedDay(query.to) },
        ...(query.userIds.length ? { userId: { $in: query.userIds.map((id) => new Types.ObjectId(id)) } } : {}),
        ...(query.projectId ? { projectId: new Types.ObjectId(query.projectId) } : {}),
        ...(query.status ? { reportStatus: query.status } : {}),
      },
    ],
  };

  // Names for every row, in three queries, limited to the people and projects in this export.
  const [userIds, projectIds] = await Promise.all([
    Task.distinct("userId", filter),
    Task.distinct("projectId", filter),
  ]);
  const [users, projects] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select("name role departmentId").lean(),
    Project.find({ _id: { $in: projectIds } }).select("name code").lean(),
  ]);
  const departments = await Department.find({ _id: { $in: users.map((user) => user.departmentId) } })
    .select("name")
    .lean();
  const userById = new Map(users.map((user) => [String(user._id), user]));
  const projectById = new Map(projects.map((project) => [String(project._id), project]));
  const departmentById = new Map(departments.map((department) => [String(department._id), department.name]));

  const [byProject, byPerson] = await Promise.all([
    Task.aggregate<{ _id: Types.ObjectId; hours: number; tasks: number }>([
      { $match: filter },
      { $group: { _id: "$projectId", hours: { $sum: { $ifNull: ["$hours", 0] } }, tasks: { $sum: 1 } } },
      { $sort: { hours: -1 } },
    ]),
    Task.aggregate<{ _id: Types.ObjectId; hours: number; tasks: number }>([
      { $match: filter },
      { $group: { _id: "$userId", hours: { $sum: { $ifNull: ["$hours", 0] } }, tasks: { $sum: 1 } } },
      { $sort: { hours: -1 } },
    ]),
  ]);

  const output = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true });

  // Rows are written from a cursor, so a large export never sits in memory.
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

      const cursor = Task.find(filter).sort({ date: 1, userId: 1 }).lean().cursor();
      for await (const task of cursor) {
        const user = userById.get(String(task.userId));
        sheet
          .addRow({
            date: dayString(task.date),
            employee: user?.name ?? "",
            role: user ? ROLE_LABELS[user.role as Role] : "",
            department: departmentById.get(String(task.departmentId)) ?? "",
            project: projectById.get(String(task.projectId))?.name ?? "",
            details: task.details,
            hours: task.hours,
            status: task.status,
            reportStatus: REPORT_STATUS_LABELS[task.reportStatus as ReportStatus],
          })
          .commit();
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
      summary.addRow([`WorkLog export, ${query.from} to ${query.to}`]).font = { bold: true, size: 14 };
      summary.addRow([]);
      section(
        "Hours per project",
        byProject.map((row) => ({ name: projectById.get(String(row._id))?.name ?? "", hours: row.hours, tasks: row.tasks })),
      );
      section(
        "Hours per person",
        byPerson.map((row) => ({ name: userById.get(String(row._id))?.name ?? "", hours: row.hours, tasks: row.tasks })),
      );
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
      "Content-Disposition": `attachment; filename="worklog-tasks-${query.from}-to-${query.to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

/** One weekly report as .xlsx, for its owner only. Anyone else gets a 404. */
export async function exportWeeklyReport(actor: Actor & { name: string }, id: Types.ObjectId) {
  const report = await WeeklyReport.findOne({ _id: id, userId: new Types.ObjectId(actor.id) }).lean();
  if (!report) throw notFound();
  const tasks = await Task.find({ weeklyReportId: id })
    .sort({ date: 1, createdAt: 1 })
    .populate<{ projectId: { name: string } }>("projectId", "name")
    .lean();

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
  sheet.addRow([`Status: ${REPORT_STATUS_LABELS[report.status]}`, "", `Total hours: ${report.totals.hours}`]);
  sheet.addRow([]);
  styleHeader(sheet.addRow(["Date", "Project", "Task details", "Hours", "Status"]));
  for (const task of tasks) {
    sheet.addRow([dayString(task.date), task.projectId?.name ?? "", task.details, task.hours, task.status]);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename="worklog-week-${report.isoYear}-${report.isoWeek}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
