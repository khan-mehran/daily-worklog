import ExcelJS from "exceljs";
import { format, subDays } from "date-fns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as aiRoute from "@/app/api/ai/improve/route";
import * as activityRoute from "@/app/api/dashboard/activity/route";
import * as ceoRoute from "@/app/api/dashboard/ceo/route";
import * as developerRoute from "@/app/api/dashboard/developer/route";
import * as leadRoute from "@/app/api/dashboard/lead/route";
import * as managerRoute from "@/app/api/dashboard/manager/route";
import * as exportRoute from "@/app/api/export/tasks/route";
import * as reportExportRoute from "@/app/api/reports/[id]/export/route";
import * as searchRoute from "@/app/api/search/route";
import * as teamRoute from "@/app/api/team/route";
import { setAiService } from "@/lib/ai";
import { DEPARTMENT_FILTER_COOKIE } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { call, FIXTURE_WEEK, makeCompany, reportTotals, request, resetDatabase, signInAs } from "./helpers";

type Company = Awaited<ReturnType<typeof makeCompany>>;
let company: Company;

const from = format(subDays(new Date(), 60), "yyyy-MM-dd");
const to = format(new Date(), "yyyy-MM-dd");
const range = `?from=${from}&to=${to}`;

beforeEach(async () => {
  await resetDatabase();
  company = await makeCompany();
});

/** A second IT developer task of `hours`, in a report at `status` within the fixture week. */
async function otherDeveloperWork(status: "SUBMITTED" | "LEAD_APPROVED" | "MANAGER_APPROVED" | "DRAFT", hours: number) {
  const { department, project, otherDeveloper } = company.it;
  const report = await prisma.weeklyReport.create({ data: {
    userId: otherDeveloper.id,
    departmentId: department.id,
    ...FIXTURE_WEEK,
    status,
    ...reportTotals(project.id, hours),
  } });
  await prisma.task.create({ data: {
    userId: otherDeveloper.id,
    departmentId: department.id,
    projectId: project.id,
    date: FIXTURE_WEEK.weekStart,
    details: `${status} work`,
    hours,
    status: "Completed",
    weeklyReportId: report.id,
    reportStatus: status,
  } });
}

describe("dashboards are role-guarded", () => {
  it.each([
    ["developer", "ceo"],
    ["lead", "developer"],
    ["manager", "lead"],
    ["ceo", "manager"],
  ] as const)("refuses the %s dashboard to a %s", async (dashboard, role) => {
    const routes = { developer: developerRoute, lead: leadRoute, manager: managerRoute, ceo: ceoRoute };
    const person = role === "ceo" ? company.ceo : company.it[role === "lead" ? "lead" : role === "developer" ? "developer" : "manager"];
    signInAs(person);
    expect((await call(routes[dashboard].GET, request("GET", `/x${range}`))).status).toBe(403);
  });

  it("validates the range", async () => {
    signInAs(company.it.developer);
    expect((await call(developerRoute.GET, request("GET", "/x?from=2024-01-01&to=2026-01-01"))).status).toBe(400);
  });
});

describe("dashboards follow the approval gate", () => {
  it("the CEO sees only fully approved hours", async () => {
    await otherDeveloperWork("LEAD_APPROVED", 5);
    signInAs(company.ceo);
    const { body } = await call(ceoRoute.GET, request("GET", `/x${range}`));
    expect(body.data.kpis.approvedHours).toBe(16);
    const it_ = body.data.byDepartment.find((row: { label: string }) => row.label === "IT");
    expect(it_.hours).toBe(8);
  });

  it("the CEO's switcher narrows everything but the department comparison", async () => {
    signInAs(company.ceo);
    const cookie = `${DEPARTMENT_FILTER_COOKIE}=${company.hr.department.id}`;
    const { body } = await call(ceoRoute.GET, request("GET", `/x${range}`, { cookie }));
    expect(body.data.kpis.approvedHours).toBe(8);
    expect(body.data.byDepartment).toHaveLength(2);
  });

  it("the Manager doesn't see a developer's work until the Team Lead approves it", async () => {
    await otherDeveloperWork("SUBMITTED", 5);
    signInAs(company.it.manager);
    expect((await call(managerRoute.GET, request("GET", `/x${range}`))).body.data.kpis.hours).toBe(8);
    signInAs(company.it.lead);
    const lead = await call(leadRoute.GET, request("GET", `/x${range}`));
    const total = lead.body.data.byProject.reduce((sum: number, row: { hours: number }) => sum + row.hours, 0);
    expect(total).toBe(13);
  });

  it("a Team Lead never sees a draft", async () => {
    await otherDeveloperWork("DRAFT", 5);
    signInAs(company.it.lead);
    const { body } = await call(leadRoute.GET, request("GET", `/x${range}`));
    expect(body.data.byProject.reduce((sum: number, row: { hours: number }) => sum + row.hours, 0)).toBe(8);
  });

  it("a developer's dashboard is their own work", async () => {
    await otherDeveloperWork("MANAGER_APPROVED", 5);
    signInAs(company.it.developer);
    const { body } = await call(developerRoute.GET, request("GET", `/x${range}`));
    expect(body.data.kpis.hours).toBe(8);
    expect(body.data.timeline).toHaveLength(1);
  });

  it("the activity feed never crosses departments", async () => {
    await prisma.reportTrailEntry.create({
      data: { reportId: company.hr.report.id, action: "SUBMITTED", byUserId: company.hr.developer.id, at: new Date() },
    });
    signInAs(company.it.manager);
    expect((await call(activityRoute.GET, request("GET", "/x"))).body.data).toEqual([]);
    signInAs(company.ceo);
    expect((await call(activityRoute.GET, request("GET", "/x"))).body.data).toHaveLength(1);
  });
});

async function readWorkbook(response: Response) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as ArrayBuffer);
  const tasks = workbook.getWorksheet("Tasks")!;
  const rows: string[][] = [];
  tasks.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map(String)));
  return { workbook, rows };
}

describe("Excel export", () => {
  const exportUrl = (query = "") => `/api/export/tasks?from=${from}&to=${to}${query}`;

  it("is refused to developers", async () => {
    signInAs(company.it.developer);
    expect((await exportRoute.GET(request("GET", exportUrl()), { params: Promise.resolve({}) })).status).toBe(403);
  });

  it("contains only the requester's department, with both sheets", async () => {
    signInAs(company.it.manager);
    const response = await exportRoute.GET(request("GET", exportUrl(`&departmentId=${company.hr.department.id}`)), {
      params: Promise.resolve({}),
    });
    expect(response.headers.get("content-type")).toContain("spreadsheetml");
    const { workbook, rows } = await readWorkbook(response);
    expect(rows[0]).toEqual(["Date", "Employee", "Role", "Department", "Project", "Task details", "Hours", "Status", "Report status"]);
    expect(rows.slice(1).map((row) => row[5])).toEqual(["IT secret task"]);
    expect(workbook.getWorksheet("Summary")).toBeTruthy();
  });

  it("respects the approval gate and the filters", async () => {
    await otherDeveloperWork("SUBMITTED", 5);
    signInAs(company.it.manager);
    const all = await readWorkbook(await exportRoute.GET(request("GET", exportUrl()), { params: Promise.resolve({}) }));
    expect(all.rows.slice(1).map((row) => row[5])).toEqual(["IT secret task"]);

    signInAs(company.it.lead);
    const lead = await readWorkbook(
      await exportRoute.GET(request("GET", exportUrl(`&status=SUBMITTED`)), { params: Promise.resolve({}) }),
    );
    expect(lead.rows.slice(1).map((row) => row[5])).toEqual(["SUBMITTED work"]);
  });

  it("gives the CEO approved work from every department, or one", async () => {
    await otherDeveloperWork("LEAD_APPROVED", 5);
    signInAs(company.ceo);
    const all = await readWorkbook(await exportRoute.GET(request("GET", exportUrl()), { params: Promise.resolve({}) }));
    expect(all.rows.slice(1).map((row) => row[5]).sort()).toEqual(["HR secret task", "IT secret task"]);
    const hr = await readWorkbook(
      await exportRoute.GET(request("GET", exportUrl(`&departmentId=${company.hr.department.id}`)), { params: Promise.resolve({}) }),
    );
    expect(hr.rows.slice(1).map((row) => row[5])).toEqual(["HR secret task"]);
  });

  it("lets only the owner download a weekly report", async () => {
    const id = company.it.report.id;
    signInAs(company.it.lead);
    expect((await reportExportRoute.GET(request("GET", "/x"), { params: Promise.resolve({ id }) })).status).toBe(404);
    signInAs(company.it.developer);
    const own = await reportExportRoute.GET(request("GET", "/x"), { params: Promise.resolve({ id }) });
    expect(own.status).toBe(200);
    expect(own.headers.get("content-disposition")).toContain(".xlsx");
  });
});

describe("Improve with AI", () => {
  afterEach(() => setAiService(undefined));
  const improve = (text: string) => call(aiRoute.POST, request("POST", "/api/ai/improve", { body: { text } }));

  it("returns the rewrite from the provider", async () => {
    setAiService({ improveWorkLog: async (text) => `Improved: ${text}` });
    signInAs(company.it.developer);
    const { status, body } = await improve("fixd the bug");
    expect(status).toBe(200);
    expect(body.data.text).toBe("Improved: fixd the bug");
  });

  it("says so when no key is configured", async () => {
    setAiService(null);
    signInAs(company.it.developer);
    const { status, body } = await improve("fixd the bug");
    expect(status).toBe(503);
    expect(body.error.code).toBe("AI_UNAVAILABLE");
  });

  it("caps input at 1000 characters", async () => {
    setAiService({ improveWorkLog: async (text) => text });
    signInAs(company.it.developer);
    expect((await improve("x".repeat(1001))).status).toBe(400);
  });

  it("limits each person to 30 requests an hour", async () => {
    setAiService({ improveWorkLog: async (text) => text });
    signInAs(company.it.developer);
    for (let index = 0; index < 30; index++) expect((await improve("a log entry")).status).toBe(200);
    expect((await improve("a log entry")).status).toBe(429);
    signInAs(company.it.lead);
    expect((await improve("a log entry")).status).toBe(200);
  });
});

describe("search and team", () => {
  it("search stays inside the department and the developer's projects", async () => {
    signInAs(company.it.manager);
    const it_ = await call(searchRoute.GET, request("GET", "/api/search?q=project"));
    expect(it_.body.data.projects.map((row: { title: string }) => row.title)).toEqual(["IT project"]);
    expect(it_.body.data.people.every((row: { id: string }) => row.id !== company.hr.developer.id)).toBe(true);

    signInAs(company.it.otherDeveloper);
    const dev = await call(searchRoute.GET, request("GET", "/api/search?q=project"));
    expect(dev.body.data.projects).toEqual([]);
    expect(dev.body.data.people).toEqual([]);
  });

  it("team shows a lead's direct reports, with hours only once submitted", async () => {
    await otherDeveloperWork("DRAFT", 5);
    signInAs(company.it.lead);
    const { body } = await call(teamRoute.GET, request("GET", "/api/team"));
    expect(body.data.map((row: { id: string }) => row.id).sort()).toEqual(
      [company.it.developer.id, company.it.otherDeveloper.id].sort(),
    );
  });

  it("team is refused to developers and scoped for managers", async () => {
    signInAs(company.it.developer);
    expect((await call(teamRoute.GET, request("GET", "/api/team"))).status).toBe(403);
    signInAs(company.it.manager);
    const { body } = await call(teamRoute.GET, request("GET", "/api/team"));
    expect(body.meta.total).toBe(3);
  });
});
