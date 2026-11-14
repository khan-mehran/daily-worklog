import { Types } from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectRoute from "@/app/api/projects/[id]/route";
import * as membersRoute from "@/app/api/projects/[id]/members/route";
import { DEPARTMENT_FILTER_COOKIE, type ReportStatus } from "@/lib/constants";
import { AuditLog, Department, Project, Task, User, WeeklyReport } from "@/models";
import { call, makeCompany, makeUser, request, resetDatabase, signInAs } from "./helpers";

type Company = Awaited<ReturnType<typeof makeCompany>>;

let company: Company;

beforeEach(async () => {
  await resetDatabase();
  company = await makeCompany();
});

const newProject = (overrides: object = {}) => ({
  name: "New Project",
  code: "new1",
  color: "sky",
  ...overrides,
});
const create = (body: unknown) =>
  call(projectsRoute.POST, request("POST", "/api/projects", { body }));
const list = async (query = "", cookie?: string) =>
  call(projectsRoute.GET, request("GET", `/api/projects${query}`, { cookie }));
const listedIds = async (query = "") =>
  (await list(query)).body.data.map((row: { id: string }) => row.id) as string[];
const patch = (id: unknown, body: unknown) =>
  call(projectRoute.PATCH, request("PATCH", "/x", { body }), { id: String(id) });
const remove = (id: unknown) =>
  call(projectRoute.DELETE, request("DELETE", "/x"), { id: String(id) });
const members = (id: unknown, body: unknown) =>
  call(membersRoute.POST, request("POST", "/x", { body }), { id: String(id) });
const detail = (id: unknown) =>
  call(projectRoute.GET, request("GET", "/x"), { id: String(id) });

describe("who sees which projects", () => {
  it("gives a developer only the projects they're assigned to", async () => {
    const hidden = await Project.create({
      departmentId: company.it.department._id,
      name: "Hidden",
      code: "HIDDEN",
      color: "teal",
      ownerId: company.it.manager._id,
      memberIds: [company.it.otherDeveloper._id],
      createdBy: company.it.manager._id,
    });
    signInAs(company.it.developer);
    expect(await listedIds()).toEqual([String(company.it.project._id)]);
    expect((await detail(hidden._id)).status).toBe(404);
    expect(await listedIds("?search=Hidden")).toEqual([]);
  });

  it("gives a developer on no projects an empty list", async () => {
    signInAs(company.it.otherDeveloper);
    expect(await listedIds()).toEqual([]);
    expect((await detail(company.it.project._id)).status).toBe(404);
  });

  it.each(["manager", "lead"] as const)(
    "shows a %s every project in their department, assigned or not",
    async (key) => {
      await Project.updateOne({ _id: company.it.project._id }, { memberIds: [] });
      signInAs(company.it[key]);
      expect(await listedIds()).toEqual([String(company.it.project._id)]);
    },
  );

  it("shows the CEO all departments, narrowed by the switcher or a filter", async () => {
    signInAs(company.ceo);
    expect(await listedIds()).toHaveLength(2);
    const hr = String(company.hr.department._id);
    expect(await listedIds(`?departmentId=${hr}`)).toEqual([String(company.hr.project._id)]);
    const switched = await list("", `${DEPARTMENT_FILTER_COOKIE}=${hr}`);
    expect(switched.body.data.map((row: { id: string }) => row.id)).toEqual([
      String(company.hr.project._id),
    ]);
  });

  it("gives an unassigned manager nothing", async () => {
    const free = await makeUser("MANAGER", null, company.ceo._id);
    signInAs(free);
    expect(await listedIds()).toEqual([]);
    expect((await create(newProject())).status).toBe(403);
  });

  it("paginates, and filters by status and search", async () => {
    signInAs(company.it.manager);
    for (const index of [1, 2, 3]) {
      await create(newProject({ name: `Batch ${index}`, code: `B${index}`, status: "On hold" }));
    }
    const page = await list("?limit=2&page=2");
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toEqual({ page: 2, limit: 2, total: 4 });
    expect(await listedIds("?status=On%20hold")).toHaveLength(3);
    expect(await listedIds("?search=batch%202")).toHaveLength(1);
  });

  it("treats regex characters in a search as plain text", async () => {
    signInAs(company.it.manager);
    expect((await list("?search=.*")).body.data).toEqual([]);
  });
});

describe("creating", () => {
  it.each(["manager", "lead"] as const)("lets a %s create in their department", async (key) => {
    signInAs(company.it[key]);
    const { status, body } = await create(newProject({ startDate: "2026-11-02", endDate: "" }));
    expect(status).toBe(201);
    const project = await Project.findById(body.data.id).lean();
    expect(String(project?.departmentId)).toBe(String(company.it.department._id));
    expect(project?.code).toBe("NEW1");
    expect(String(project?.ownerId)).toBe(String(company.it[key]._id));
    expect(project?.startDate?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(project?.endDate).toBeNull();
    expect(await AuditLog.countDocuments({ action: "project.create" })).toBe(1);
  });

  it("ignores a departmentId sent by the client", async () => {
    signInAs(company.it.manager);
    const { body } = await create(newProject({ departmentId: String(company.hr.department._id) }));
    const project = await Project.findById(body.data.id).lean();
    expect(String(project?.departmentId)).toBe(String(company.it.department._id));
  });

  it.each(["developer"] as const)("forbids a %s", async (key) => {
    signInAs(company.it[key]);
    expect((await create(newProject())).status).toBe(403);
  });

  it("keeps the CEO read-only", async () => {
    signInAs(company.ceo);
    expect((await create(newProject())).status).toBe(403);
    expect((await patch(company.it.project._id, { name: "Changed" })).status).toBe(403);
    expect((await remove(company.it.project._id)).status).toBe(403);
    expect(
      (await members(company.it.project._id, { remove: [String(company.it.developer._id)] })).status,
    ).toBe(403);
  });

  it("assigns members from the department and refuses anyone else", async () => {
    signInAs(company.it.manager);
    const good = await create(newProject({ memberIds: [String(company.it.developer._id)] }));
    expect(good.status).toBe(201);

    const other = await create(
      newProject({ code: "NEW2", memberIds: [String(company.hr.developer._id)] }),
    );
    expect(other.status).toBe(400);
    const ceo = await create(newProject({ code: "NEW3", memberIds: [String(company.ceo._id)] }));
    expect(ceo.status).toBe(400);
    expect(await Project.exists({ code: { $in: ["NEW2", "NEW3"] } })).toBeNull();
  });

  it("refuses a deactivated member", async () => {
    await User.updateOne({ _id: company.it.otherDeveloper._id }, { isActive: false });
    signInAs(company.it.manager);
    const { status } = await create(
      newProject({ memberIds: [String(company.it.otherDeveloper._id)] }),
    );
    expect(status).toBe(400);
  });

  it("requires a unique code within the department, but not across them", async () => {
    signInAs(company.it.manager);
    expect((await create(newProject({ code: "PRJ" }))).status).toBe(409);
    signInAs(company.hr.manager);
    expect((await create(newProject({ code: "NEW1" }))).status).toBe(201);
    signInAs(company.it.manager);
    expect((await create(newProject({ code: "new1" }))).status).toBe(201);
  });

  it.each([
    ["a short name", { name: "x" }],
    ["a bad code", { code: "no spaces!" }],
    ["a colour outside the palette", { color: "#ff0000" }],
    ["an unknown status", { status: "Paused" }],
    ["an impossible date", { startDate: "2026-02-31" }],
    ["an end before the start", { startDate: "2026-11-02", endDate: "2026-11-01" }],
  ])("rejects %s", async (_label, overrides) => {
    signInAs(company.it.manager);
    const { status, body } = await create(newProject(overrides));
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("won't create projects in an archived department", async () => {
    await Department.updateOne({ _id: company.it.department._id }, { status: "Archived" });
    signInAs(company.it.manager);
    expect((await create(newProject())).status).toBe(409);
  });
});

describe("updating and deleting", () => {
  it("changes only what's sent", async () => {
    await Project.updateOne(
      { _id: company.it.project._id },
      { startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") },
    );
    signInAs(company.it.lead);
    expect((await patch(company.it.project._id, { status: "Completed" })).status).toBe(200);
    const project = await Project.findById(company.it.project._id).lean();
    expect(project?.status).toBe("Completed");
    expect(project?.startDate?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(project?.endDate?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  it("clears a date when asked", async () => {
    await Project.updateOne({ _id: company.it.project._id }, { endDate: new Date("2026-12-31") });
    signInAs(company.it.lead);
    await patch(company.it.project._id, { endDate: null });
    expect((await Project.findById(company.it.project._id).lean())?.endDate).toBeNull();
  });

  it("checks a single new date against the stored one", async () => {
    await Project.updateOne({ _id: company.it.project._id }, { startDate: new Date("2026-06-01") });
    signInAs(company.it.lead);
    expect((await patch(company.it.project._id, { endDate: "2026-01-01" })).status).toBe(400);
  });

  it("can't be moved to another department", async () => {
    signInAs(company.it.manager);
    await patch(company.it.project._id, {
      name: "Still IT",
      departmentId: String(company.hr.department._id),
    });
    const project = await Project.findById(company.it.project._id).lean();
    expect(String(project?.departmentId)).toBe(String(company.it.department._id));
  });

  it("forbids an assigned developer from changing their project", async () => {
    signInAs(company.it.developer);
    expect((await patch(company.it.project._id, { name: "Mine" })).status).toBe(403);
    expect((await remove(company.it.project._id)).status).toBe(403);
    expect(
      (await members(company.it.project._id, { add: [String(company.it.otherDeveloper._id)] })).status,
    ).toBe(403);
  });

  it("hides a project from an unassigned developer's writes with a 404", async () => {
    signInAs(company.it.otherDeveloper);
    expect((await patch(company.it.project._id, { name: "Mine" })).status).toBe(404);
  });

  it("refuses to delete a project with logged work", async () => {
    signInAs(company.it.manager);
    const { status, body } = await remove(company.it.project._id);
    expect(status).toBe(409);
    expect(body.error.code).toBe("PROJECT_HAS_TASKS");
  });

  it("deletes an unused project", async () => {
    signInAs(company.it.manager);
    const created = await create(newProject());
    expect((await remove(created.body.data.id)).status).toBe(200);
    expect(await Project.exists({ _id: created.body.data.id })).toBeNull();
  });
});

describe("members", () => {
  const id = () => company.it.project._id;
  const memberIds = async () =>
    (await Project.findById(id()).lean())?.memberIds.map(String) ?? [];

  beforeEach(() => signInAs(company.it.lead));

  it("adds and removes in one request, and keeps others", async () => {
    const { otherDeveloper, developer, lead } = company.it;
    const { status } = await members(id(), {
      add: [String(otherDeveloper._id)],
      remove: [String(developer._id)],
    });
    expect(status).toBe(200);
    expect((await memberIds()).sort()).toEqual(
      [String(otherDeveloper._id), String(lead._id)].sort(),
    );
  });

  it("doesn't add someone twice", async () => {
    await members(id(), { add: [String(company.it.developer._id)] });
    const ids = await memberIds();
    expect(ids.filter((value) => value === String(company.it.developer._id))).toHaveLength(1);
  });

  it("refuses people from another department and changes nothing", async () => {
    const before = await memberIds();
    const { status } = await members(id(), {
      add: [String(company.hr.developer._id)],
      remove: [String(company.it.developer._id)],
    });
    expect(status).toBe(400);
    expect(await memberIds()).toEqual(before);
  });

  it("refuses an empty change", async () => {
    expect((await members(id(), { add: [], remove: [] })).status).toBe(400);
  });

  it("takes effect for the developer at once", async () => {
    await members(id(), { remove: [String(company.it.developer._id)] });
    signInAs(company.it.developer);
    expect((await detail(id())).status).toBe(404);
  });
});

describe("project activity follows the approval gate", () => {
  /** One logged task by `owner` on the IT project, in a report at `status`. */
  async function logWork(owner: { _id: Types.ObjectId }, status: ReportStatus, isoWeek: number, hours: number) {
    const { department, project } = company.it;
    const report = await WeeklyReport.create({
      userId: owner._id,
      departmentId: department._id,
      isoYear: 2026,
      isoWeek,
      weekStart: new Date(Date.UTC(2026, 0, isoWeek * 7)),
      weekEnd: new Date(Date.UTC(2026, 0, isoWeek * 7 + 6)),
      status,
      totals: {
        hours,
        taskCount: 1,
        completedCount: 0,
        blockedCount: 1,
        byProject: [{ projectId: project._id, hours, taskCount: 1 }],
      },
    });
    await Project.updateOne({ _id: project._id }, { $addToSet: { memberIds: owner._id } });
    const details = `${status} work by ${owner._id}`;
    await Task.create({
      userId: owner._id,
      departmentId: department._id,
      projectId: project._id,
      date: report.weekStart,
      details,
      hours,
      status: "Blocked",
      weeklyReportId: report._id,
    });
    return details;
  }

  async function seenBy(user: { _id: Types.ObjectId }) {
    signInAs(user);
    const { body } = await detail(company.it.project._id);
    return body.data.activity as {
      totalHours: number;
      blockedCount: number;
      contributorCount: number;
      recentTasks: { details: string }[];
    };
  }
  const texts = (activity: { recentTasks: { details: string }[] }) =>
    activity.recentTasks.map((task) => task.details);

  // The fixture already holds one MANAGER_APPROVED report of 8 hours by company.it.developer.
  it("hides a draft from everyone but its owner", async () => {
    const { otherDeveloper, lead, manager } = company.it;
    const details = await logWork(otherDeveloper, "DRAFT", 40, 5);
    expect(texts(await seenBy(otherDeveloper))).toContain(details);
    expect(texts(await seenBy(lead))).not.toContain(details);
    expect(texts(await seenBy(manager))).not.toContain(details);
    expect(texts(await seenBy(company.ceo))).not.toContain(details);
  });

  it("shows a submitted report to the direct approver, not the Manager or CEO", async () => {
    const { otherDeveloper, lead, manager } = company.it;
    const details = await logWork(otherDeveloper, "SUBMITTED", 40, 5);
    expect(texts(await seenBy(lead))).toContain(details);
    expect((await seenBy(lead)).totalHours).toBe(13);
    expect(texts(await seenBy(manager))).not.toContain(details);
    expect((await seenBy(manager)).totalHours).toBe(8);
    expect(texts(await seenBy(company.ceo))).not.toContain(details);
  });

  it("shows a lead-approved report to the Manager, not the CEO", async () => {
    const { otherDeveloper, manager } = company.it;
    const details = await logWork(otherDeveloper, "LEAD_APPROVED", 40, 5);
    expect(texts(await seenBy(manager))).toContain(details);
    expect(texts(await seenBy(company.ceo))).not.toContain(details);
    expect((await seenBy(company.ceo)).totalHours).toBe(8);
  });

  it("shows the CEO a report once it's fully approved", async () => {
    const details = await logWork(company.it.otherDeveloper, "MANAGER_APPROVED", 40, 5);
    const activity = await seenBy(company.ceo);
    expect(texts(activity)).toContain(details);
    expect(activity.totalHours).toBe(13);
    expect(activity.contributorCount).toBe(2);
  });

  it("shows a Team Lead's submitted report to their Manager", async () => {
    const { lead, manager } = company.it;
    const details = await logWork(lead, "SUBMITTED", 40, 5);
    expect(texts(await seenBy(manager))).toContain(details);
    expect(texts(await seenBy(company.ceo))).not.toContain(details);
  });

  it("shows a developer only their own work on a shared project", async () => {
    const { developer, otherDeveloper } = company.it;
    const details = await logWork(otherDeveloper, "MANAGER_APPROVED", 40, 5);
    const mine = await seenBy(developer);
    expect(texts(mine)).not.toContain(details);
    expect(mine.totalHours).toBe(8);
    expect(mine.contributorCount).toBe(1);
  });

  it("gates blocked counts the same way", async () => {
    await logWork(company.it.otherDeveloper, "SUBMITTED", 40, 5);
    expect((await seenBy(company.it.lead)).blockedCount).toBe(1);
    expect((await seenBy(company.it.manager)).blockedCount).toBe(0);
  });

  it("returns no sensitive member fields", async () => {
    signInAs(company.it.developer);
    const { body } = await detail(company.it.project._id);
    expect(body.data.members[0]).not.toHaveProperty("email");
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|inviteToken/);
  });
});
