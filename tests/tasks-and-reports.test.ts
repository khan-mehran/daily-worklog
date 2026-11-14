import { format, subDays } from "date-fns";
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as copyRoute from "@/app/api/tasks/copy/route";
import * as templatesRoute from "@/app/api/task-templates/route";
import * as templateRoute from "@/app/api/task-templates/[id]/route";
import * as mineRoute from "@/app/api/reports/mine/route";
import * as queueRoute from "@/app/api/reports/review-queue/route";
import * as reportRoute from "@/app/api/reports/[id]/route";
import * as submitRoute from "@/app/api/reports/[id]/submit/route";
import * as approveRoute from "@/app/api/reports/[id]/approve/route";
import * as changesRoute from "@/app/api/reports/[id]/request-changes/route";
import * as projectRoute from "@/app/api/projects/[id]/route";
import { sendEmailSafely } from "@/lib/email";
import { Notification, Project, Task, User, WeeklyReport } from "@/models";
import { call, makeCompany, request, resetDatabase, signInAs } from "./helpers";

type Company = Awaited<ReturnType<typeof makeCompany>>;
type Person = { _id: Types.ObjectId };

let company: Company;
const today = format(new Date(), "yyyy-MM-dd");

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(sendEmailSafely).mockClear();
  company = await makeCompany();
});

const addTask = (body: object) =>
  call(tasksRoute.POST, request("POST", "/api/tasks", { body }));
const task = (overrides: object = {}) => ({
  projectId: String(company.it.project._id),
  details: "Built the export screen.",
  hours: 3,
  date: today,
  ...overrides,
});
const reportOf = async (person: Person, date = today) => {
  const created = await Task.findOne({ userId: person._id, date: new Date(`${date}T00:00:00.000Z`) }).lean();
  return WeeklyReport.findById(created!.weeklyReportId).lean();
};
const act = (route: { POST: typeof submitRoute.POST }, id: unknown, body?: object) =>
  call(route.POST, request("POST", "/x", { body }), { id: String(id) });
const openReport = (id: unknown) =>
  call(reportRoute.GET, request("GET", "/x"), { id: String(id) });

describe("logging tasks", () => {
  it("creates the week's draft report and keeps its totals", async () => {
    signInAs(company.it.developer);
    expect((await addTask(task())).status).toBe(201);
    expect((await addTask(task({ hours: 1.5, status: "Blocked" }))).status).toBe(201);
    const report = await reportOf(company.it.developer);
    expect(report).toMatchObject({ status: "DRAFT" });
    expect(report?.totals).toMatchObject({ hours: 4.5, taskCount: 2, blockedCount: 1, completedCount: 1 });
    expect(String(report?.departmentId)).toBe(String(company.it.department._id));
  });

  it("only allows assigned projects for a developer", async () => {
    signInAs(company.it.otherDeveloper);
    const { status, body } = await addTask(task());
    expect(status).toBe(400);
    expect(body.error.code).toBe("PROJECT_NOT_ALLOWED");
  });

  it("refuses another department's project with the same message", async () => {
    signInAs(company.it.lead);
    const { body } = await addTask(task({ projectId: String(company.hr.project._id) }));
    expect(body.error.code).toBe("PROJECT_NOT_ALLOWED");
  });

  it("lets a Team Lead log on any department project, assigned or not", async () => {
    await Project.updateOne({ _id: company.it.project._id }, { memberIds: [] });
    signInAs(company.it.lead);
    expect((await addTask(task())).status).toBe(201);
  });

  it("refuses completed projects, future dates and the CEO", async () => {
    signInAs(company.it.developer);
    const tomorrowPlusOne = format(new Date(Date.now() + 3 * 864e5), "yyyy-MM-dd");
    expect((await addTask(task({ date: tomorrowPlusOne }))).status).toBe(400);
    await Project.updateOne({ _id: company.it.project._id }, { status: "Completed" });
    expect((await addTask(task())).status).toBe(400);
    signInAs(company.ceo);
    expect((await addTask(task())).status).toBe(403);
  });

  it.each([
    ["no details", { details: "" }],
    ["too many hours", { hours: 25 }],
    ["odd minutes", { hours: 1.1 }],
    ["a bad status", { status: "Done" }],
    ["a bad date", { date: "2026-13-01" }],
  ])("validates %s", async (_label, overrides) => {
    signInAs(company.it.developer);
    expect((await addTask(task(overrides))).status).toBe(400);
  });

  it("ignores a userId or departmentId in the body", async () => {
    signInAs(company.it.developer);
    const { body } = await addTask(
      task({ userId: String(company.hr.developer._id), departmentId: String(company.hr.department._id) }),
    );
    const created = await Task.findById(body.data.id).lean();
    expect(String(created?.userId)).toBe(String(company.it.developer._id));
    expect(String(created?.departmentId)).toBe(String(company.it.department._id));
  });

  it("lists only the caller's own tasks", async () => {
    signInAs(company.it.developer);
    await addTask(task());
    signInAs(company.it.lead);
    await addTask(task({ details: "Lead's own work." }));
    const { body } = await call(
      tasksRoute.GET,
      request("GET", `/api/tasks?from=${format(subDays(new Date(), 7), "yyyy-MM-dd")}&to=${today}`),
    );
    expect(body.data.tasks.map((row: { details: string }) => row.details)).toEqual(["Lead's own work."]);
  });

  it("caps the range of a task list", async () => {
    signInAs(company.it.developer);
    const { status } = await call(tasksRoute.GET, request("GET", "/api/tasks?from=2026-01-01&to=2026-06-01"));
    expect(status).toBe(400);
  });

  it("makes other people's tasks a 404, even for their approver", async () => {
    signInAs(company.it.developer);
    const { body } = await addTask(task());
    const id = body.data.id;
    for (const person of [company.it.lead, company.it.otherDeveloper, company.hr.developer]) {
      signInAs(person);
      const edit = await call(taskRoute.PATCH, request("PATCH", "/x", { body: { hours: 1 } }), { id });
      const remove = await call(taskRoute.DELETE, request("DELETE", "/x"), { id });
      expect([edit.status, remove.status]).toEqual([404, 404]);
    }
  });

  it("moves a task between weeks and updates both reports", async () => {
    signInAs(company.it.developer);
    const lastWeek = format(subDays(new Date(), 7), "yyyy-MM-dd");
    const { body } = await addTask(task());
    const thisWeekReport = await reportOf(company.it.developer);
    await call(taskRoute.PATCH, request("PATCH", "/x", { body: { date: lastWeek } }), { id: body.data.id });
    expect((await WeeklyReport.findById(thisWeekReport!._id).lean())?.totals.taskCount).toBe(0);
    expect((await reportOf(company.it.developer, lastWeek))?.totals.taskCount).toBe(1);
  });
});

describe("copying and templates", () => {
  it("copies the latest earlier day and skips projects no longer allowed", async () => {
    signInAs(company.it.developer);
    const earlier = format(subDays(new Date(), 3), "yyyy-MM-dd");
    await addTask(task({ date: earlier }));
    await addTask(task({ date: earlier, details: "Second task." }));
    const { status, body } = await call(copyRoute.POST, request("POST", "/x", { body: { date: today } }));
    expect(status).toBe(200);
    expect(body.data).toEqual({ copied: 2, skipped: 0, from: earlier });

    await Project.updateOne({ _id: company.it.project._id }, { $pull: { memberIds: company.it.developer._id } });
    const again = await call(copyRoute.POST, request("POST", "/x", { body: { date: today } }));
    expect(again.body.data).toMatchObject({ copied: 0, skipped: 2 });
  });

  it("says when there's nothing to copy", async () => {
    signInAs(company.it.developer);
    const { body } = await call(copyRoute.POST, request("POST", "/x", { body: { date: today } }));
    expect(body.error.code).toBe("NOTHING_TO_COPY");
  });

  it("keeps templates private to their owner", async () => {
    signInAs(company.it.developer);
    const created = await call(
      templatesRoute.POST,
      request("POST", "/x", { body: { projectId: String(company.it.project._id), details: "Daily standup" } }),
    );
    expect(created.status).toBe(201);
    signInAs(company.it.lead);
    expect((await call(templatesRoute.GET, request("GET", "/x"))).body.data).toEqual([]);
    const id = created.body.data.id;
    expect((await call(templateRoute.DELETE, request("DELETE", "/x"), { id })).status).toBe(404);
    signInAs(company.it.developer);
    expect((await call(templatesRoute.GET, request("GET", "/x"))).body.data).toHaveLength(1);
    expect((await call(templateRoute.DELETE, request("DELETE", "/x"), { id })).status).toBe(200);
  });
});

describe("the workflow through the API", () => {
  async function submittedDevReport() {
    signInAs(company.it.developer);
    await addTask(task());
    const report = await reportOf(company.it.developer);
    expect((await act(submitRoute, report!._id)).status).toBe(200);
    return report!._id;
  }

  it("locks tasks on submit, and refuses an empty week", async () => {
    signInAs(company.it.developer);
    const empty = await WeeklyReport.create({
      userId: company.it.developer._id,
      departmentId: company.it.department._id,
      isoYear: 2025,
      isoWeek: 1,
      weekStart: new Date("2024-12-30"),
      weekEnd: new Date("2025-01-05"),
    });
    expect((await act(submitRoute, empty._id)).body.error.code).toBe("EMPTY_REPORT");

    const id = await submittedDevReport();
    const created = await Task.findOne({ weeklyReportId: id }).lean();
    expect(created?.reportStatus).toBe("SUBMITTED");
    const edit = await call(taskRoute.PATCH, request("PATCH", "/x", { body: { hours: 1 } }), {
      id: String(created!._id),
    });
    expect(edit.body.error.code).toBe("REPORT_LOCKED");
    expect((await addTask(task())).body.error.code).toBe("REPORT_LOCKED");
  });

  it("notifies only the direct approver on submit, by email and in the app", async () => {
    const id = await submittedDevReport();
    const notes = await Notification.find({ reportId: id }).lean();
    expect(notes.map((note) => String(note.recipientId))).toEqual([String(company.it.lead._id)]);
    expect(vi.mocked(sendEmailSafely).mock.calls.map((args) => args[0].to)).toEqual([company.it.lead.email]);
  });

  it("is invisible to the Manager and CEO until the Team Lead clicks Done", async () => {
    const id = await submittedDevReport();
    for (const person of [company.it.manager, company.ceo, company.hr.manager, company.it.otherDeveloper]) {
      signInAs(person);
      expect((await openReport(id)).status).toBe(404);
      expect((await act(approveRoute, id)).status).toBe(404);
    }
    signInAs(company.it.lead);
    expect((await openReport(id)).body.data.permissions.canReview).toBe(true);
    const queue = await call(queueRoute.GET, request("GET", "/x"));
    expect(queue.body.data.map((row: { id: string }) => row.id)).toEqual([String(id)]);
  });

  it("Team Lead approval reaches the Manager only, and Manager approval the CEO only", async () => {
    const id = await submittedDevReport();
    vi.mocked(sendEmailSafely).mockClear();
    await Notification.deleteMany({});

    signInAs(company.it.lead);
    expect((await act(approveRoute, id)).body.data.status).toBe("LEAD_APPROVED");
    let notes = await Notification.find({ reportId: id }).lean();
    expect(notes.map((note) => String(note.recipientId))).toEqual([String(company.it.manager._id)]);
    expect(vi.mocked(sendEmailSafely).mock.calls.map((args) => args[0].to)).toEqual([company.it.manager.email]);

    signInAs(company.ceo);
    expect((await openReport(id)).status).toBe(404);

    vi.mocked(sendEmailSafely).mockClear();
    await Notification.deleteMany({});
    signInAs(company.it.manager);
    expect((await act(approveRoute, id)).body.data.status).toBe("MANAGER_APPROVED");
    notes = await Notification.find({ reportId: id }).lean();
    expect(notes.map((note) => String(note.recipientId))).toEqual([String(company.ceo._id)]);
    expect(vi.mocked(sendEmailSafely).mock.calls.map((args) => args[0].to)).toEqual([company.ceo.email]);

    signInAs(company.ceo);
    const seen = await openReport(id);
    expect(seen.status).toBe(200);
    expect(seen.body.data.trail.map((entry: { action: string }) => entry.action)).toEqual([
      "SUBMITTED",
      "LEAD_APPROVED",
      "MANAGER_APPROVED",
    ]);
    expect((await Task.findOne({ weeklyReportId: id }).lean())?.reportStatus).toBe("MANAGER_APPROVED");
  });

  it("request changes unlocks the tasks and tells the owner", async () => {
    const id = await submittedDevReport();
    signInAs(company.it.lead);
    expect((await act(changesRoute, id, { comment: "" })).status).toBe(400);
    vi.mocked(sendEmailSafely).mockClear();
    const sent = await act(changesRoute, id, { comment: "Add Wednesday's hours." });
    expect(sent.body.data.status).toBe("CHANGES_REQUESTED");
    const note = await Notification.findOne({ reportId: id, type: "REPORT_CHANGES_REQUESTED" }).lean();
    expect(String(note?.recipientId)).toBe(String(company.it.developer._id));
    expect(note?.message).toContain("Add Wednesday's hours.");
    expect(vi.mocked(sendEmailSafely).mock.calls[0]![0].to).toBe(company.it.developer.email);

    signInAs(company.it.developer);
    const created = await Task.findOne({ weeklyReportId: id }).lean();
    const edit = await call(taskRoute.PATCH, request("PATCH", "/x", { body: { hours: 2 } }), {
      id: String(created!._id),
    });
    expect(edit.status).toBe(200);
    expect((await act(submitRoute, id)).body.data.status).toBe("SUBMITTED");
    signInAs(company.it.lead);
    expect((await openReport(id)).body.data.trail).toHaveLength(3);
  });

  it("a Manager's report goes straight to the CEO for acknowledgement", async () => {
    signInAs(company.it.manager);
    await addTask(task());
    const report = await reportOf(company.it.manager);
    await act(submitRoute, report!._id);
    signInAs(company.ceo);
    const queue = await call(queueRoute.GET, request("GET", "/x"));
    expect(queue.body.data.map((row: { id: string }) => row.id)).toEqual([String(report!._id)]);
    expect((await act(approveRoute, report!._id)).body.data.status).toBe("MANAGER_APPROVED");
    const trail = (await WeeklyReport.findById(report!._id).lean())?.approvalTrail ?? [];
    expect(trail.at(-1)?.action).toBe("CEO_ACKNOWLEDGED");
  });

  it("keeps a submitted Manager report out of the CEO's approved figures", async () => {
    signInAs(company.it.manager);
    await addTask(task({ hours: 7 }));
    const report = await reportOf(company.it.manager);
    await act(submitRoute, report!._id);
    signInAs(company.ceo);
    const project = await call(projectRoute.GET, request("GET", "/x"), { id: String(company.it.project._id) });
    expect(project.body.data.activity.totalHours).toBe(8);
  });

  it("only lets the current approver act, and only once", async () => {
    const id = await submittedDevReport();
    signInAs(company.it.developer);
    expect((await act(approveRoute, id)).status).toBe(403);
    signInAs(company.it.lead);
    expect((await act(approveRoute, id)).status).toBe(200);
    expect((await act(approveRoute, id)).status).toBe(403);
  });

  it("lists the owner's reports, newest first and paginated", async () => {
    signInAs(company.it.developer);
    await addTask(task());
    await addTask(task({ date: format(subDays(new Date(), 7), "yyyy-MM-dd") }));
    const { body } = await call(mineRoute.GET, request("GET", "/x?limit=2"));
    expect(body.meta.total).toBe(3);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].weekStart > body.data[1].weekStart).toBe(true);
  });

  it("returns the user's role but no email or secrets on a report", async () => {
    await User.updateOne({ _id: company.it.developer._id }, { passwordHash: "secret-hash" });
    const id = await submittedDevReport();
    signInAs(company.it.lead);
    const { body } = await openReport(id);
    expect(body.data.owner).toMatchObject({ role: "DEVELOPER" });
    expect(JSON.stringify(body)).not.toMatch(/secret-hash|@test\.local/);
  });
});
