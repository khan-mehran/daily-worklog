import { beforeEach, describe, expect, it } from "vitest";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectRoute from "@/app/api/projects/[id]/route";
import * as membersRoute from "@/app/api/projects/[id]/members/route";
import { DEPARTMENT_FILTER_COOKIE, type ReportStatus } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { call, makeCompany, makeUser, memberIdsOf, reportTotals, request, resetDatabase, setMembers, signInAs } from "./helpers";

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
    const hidden = await prisma.project.create({ data: {
      departmentId: company.it.department.id,
      name: "Hidden",
      code: "HIDDEN",
      color: "teal",
      ownerId: company.it.manager.id,
      members: { create: [{ userId: company.it.otherDeveloper.id }] },
      createdBy: company.it.manager.id,
    } });
    signInAs(company.it.developer);
    expect(await listedIds()).toEqual([company.it.project.id]);
    expect((await detail(hidden.id)).status).toBe(404);
    expect(await listedIds("?search=Hidden")).toEqual([]);
  });

  it("gives a developer on no projects an empty list", async () => {
    signInAs(company.it.otherDeveloper);
    expect(await listedIds()).toEqual([]);
    expect((await detail(company.it.project.id)).status).toBe(404);
  });

  it.each(["manager", "lead"] as const)(
    "shows a %s every project in their department, assigned or not",
    async (key) => {
      await setMembers(company.it.project.id, []);
      signInAs(company.it[key]);
      expect(await listedIds()).toEqual([company.it.project.id]);
    },
  );

  it("shows the CEO all departments, narrowed by the switcher or a filter", async () => {
    signInAs(company.ceo);
    expect(await listedIds()).toHaveLength(2);
    const hr = company.hr.department.id;
    expect(await listedIds(`?departmentId=${hr}`)).toEqual([company.hr.project.id]);
    const switched = await list("", `${DEPARTMENT_FILTER_COOKIE}=${hr}`);
    expect(switched.body.data.map((row: { id: string }) => row.id)).toEqual([
      company.hr.project.id,
    ]);
  });

  it("gives an unassigned manager nothing", async () => {
    const free = await makeUser("MANAGER", null, company.ceo.id);
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
    const project = await prisma.project.findUnique({ where: { id: body.data.id } });
    expect(String(project?.departmentId)).toBe(company.it.department.id);
    expect(project?.code).toBe("NEW1");
    expect(String(project?.ownerId)).toBe(company.it[key].id);
    expect(project?.startDate?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(project?.endDate).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "project.create" } })).toBe(1);
  });

  it("ignores a departmentId sent by the client", async () => {
    signInAs(company.it.manager);
    const { body } = await create(newProject({ departmentId: company.hr.department.id }));
    const project = await prisma.project.findUnique({ where: { id: body.data.id } });
    expect(String(project?.departmentId)).toBe(company.it.department.id);
  });

  it.each(["developer"] as const)("forbids a %s", async (key) => {
    signInAs(company.it[key]);
    expect((await create(newProject())).status).toBe(403);
  });

  it("keeps the CEO read-only", async () => {
    signInAs(company.ceo);
    expect((await create(newProject())).status).toBe(403);
    expect((await patch(company.it.project.id, { name: "Changed" })).status).toBe(403);
    expect((await remove(company.it.project.id)).status).toBe(403);
    expect(
      (await members(company.it.project.id, { remove: [company.it.developer.id] })).status,
    ).toBe(403);
  });

  it("assigns members from the department and refuses anyone else", async () => {
    signInAs(company.it.manager);
    const good = await create(newProject({ memberIds: [company.it.developer.id] }));
    expect(good.status).toBe(201);

    const other = await create(
      newProject({ code: "NEW2", memberIds: [company.hr.developer.id] }),
    );
    expect(other.status).toBe(400);
    const ceo = await create(newProject({ code: "NEW3", memberIds: [company.ceo.id] }));
    expect(ceo.status).toBe(400);
    expect(await prisma.project.findFirst({ where: { code: { in: ["NEW2", "NEW3"] } } })).toBeNull();
  });

  it("refuses a deactivated member", async () => {
    await prisma.user.updateMany({ where: { id: company.it.otherDeveloper.id }, data: { isActive: false } });
    signInAs(company.it.manager);
    const { status } = await create(
      newProject({ memberIds: [company.it.otherDeveloper.id] }),
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
    await prisma.department.updateMany({ where: { id: company.it.department.id }, data: { status: "Archived" } });
    signInAs(company.it.manager);
    expect((await create(newProject())).status).toBe(409);
  });
});

describe("updating and deleting", () => {
  it("changes only what's sent", async () => {
    await prisma.project.updateMany({ where: { id: company.it.project.id }, data: { startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
    signInAs(company.it.lead);
    expect((await patch(company.it.project.id, { status: "Completed" })).status).toBe(200);
    const project = await prisma.project.findUnique({ where: { id: company.it.project.id } });
    expect(project?.status).toBe("Completed");
    expect(project?.startDate?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(project?.endDate?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  it("clears a date when asked", async () => {
    await prisma.project.updateMany({ where: { id: company.it.project.id }, data: { endDate: new Date("2026-12-31") } });
    signInAs(company.it.lead);
    await patch(company.it.project.id, { endDate: null });
    expect((await prisma.project.findUnique({ where: { id: company.it.project.id } }))?.endDate).toBeNull();
  });

  it("checks a single new date against the stored one", async () => {
    await prisma.project.updateMany({ where: { id: company.it.project.id }, data: { startDate: new Date("2026-06-01") } });
    signInAs(company.it.lead);
    expect((await patch(company.it.project.id, { endDate: "2026-01-01" })).status).toBe(400);
  });

  it("can't be moved to another department", async () => {
    signInAs(company.it.manager);
    await patch(company.it.project.id, {
      name: "Still IT",
      departmentId: company.hr.department.id,
    });
    const project = await prisma.project.findUnique({ where: { id: company.it.project.id } });
    expect(String(project?.departmentId)).toBe(company.it.department.id);
  });

  it("forbids an assigned developer from changing their project", async () => {
    signInAs(company.it.developer);
    expect((await patch(company.it.project.id, { name: "Mine" })).status).toBe(403);
    expect((await remove(company.it.project.id)).status).toBe(403);
    expect(
      (await members(company.it.project.id, { add: [company.it.otherDeveloper.id] })).status,
    ).toBe(403);
  });

  it("hides a project from an unassigned developer's writes with a 404", async () => {
    signInAs(company.it.otherDeveloper);
    expect((await patch(company.it.project.id, { name: "Mine" })).status).toBe(404);
  });

  it("refuses to delete a project with logged work", async () => {
    signInAs(company.it.manager);
    const { status, body } = await remove(company.it.project.id);
    expect(status).toBe(409);
    expect(body.error.code).toBe("PROJECT_HAS_TASKS");
  });

  it("deletes an unused project", async () => {
    signInAs(company.it.manager);
    const created = await create(newProject());
    expect((await remove(created.body.data.id)).status).toBe(200);
    expect(await prisma.project.findFirst({ where: { id: created.body.data.id } })).toBeNull();
  });
});

describe("members", () => {
  const id = () => company.it.project.id;
  const memberIds = () => memberIdsOf(id());

  beforeEach(() => signInAs(company.it.lead));

  it("adds and removes in one request, and keeps others", async () => {
    const { otherDeveloper, developer, lead } = company.it;
    const { status } = await members(id(), {
      add: [otherDeveloper.id],
      remove: [developer.id],
    });
    expect(status).toBe(200);
    expect((await memberIds()).sort()).toEqual(
      [otherDeveloper.id, lead.id].sort(),
    );
  });

  it("doesn't add someone twice", async () => {
    await members(id(), { add: [company.it.developer.id] });
    const ids = await memberIds();
    expect(ids.filter((value) => value === company.it.developer.id)).toHaveLength(1);
  });

  it("refuses people from another department and changes nothing", async () => {
    const before = await memberIds();
    const { status } = await members(id(), {
      add: [company.hr.developer.id],
      remove: [company.it.developer.id],
    });
    expect(status).toBe(400);
    expect(await memberIds()).toEqual(before);
  });

  it("refuses an empty change", async () => {
    expect((await members(id(), { add: [], remove: [] })).status).toBe(400);
  });

  it("takes effect for the developer at once", async () => {
    await members(id(), { remove: [company.it.developer.id] });
    signInAs(company.it.developer);
    expect((await detail(id())).status).toBe(404);
  });
});

describe("project activity follows the approval gate", () => {
  /** One logged task by `owner` on the IT project, in a report at `status`. */
  async function logWork(owner: { id: string }, status: ReportStatus, isoWeek: number, hours: number) {
    const { department, project } = company.it;
    const report = await prisma.weeklyReport.create({ data: {
      userId: owner.id,
      departmentId: department.id,
      isoYear: 2026,
      isoWeek,
      weekStart: new Date(Date.UTC(2026, 0, isoWeek * 7)),
      weekEnd: new Date(Date.UTC(2026, 0, isoWeek * 7 + 6)),
      status,
      ...reportTotals(project.id, hours, { completedCount: 0, blockedCount: 1 }),
    } });
    await prisma.projectMember.createMany({ data: [{ projectId: project.id, userId: owner.id }], skipDuplicates: true });
    const details = `${status} work by ${owner.id}`;
    await prisma.task.create({ data: {
      userId: owner.id,
      departmentId: department.id,
      projectId: project.id,
      date: report.weekStart,
      details,
      hours,
      status: "Blocked",
      weeklyReportId: report.id,
      reportStatus: status,
    } });
    return details;
  }

  async function seenBy(user: { id: string }) {
    signInAs(user);
    const { body } = await detail(company.it.project.id);
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
    const { body } = await detail(company.it.project.id);
    expect(body.data.members[0]).not.toHaveProperty("email");
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|inviteToken/);
  });
});
