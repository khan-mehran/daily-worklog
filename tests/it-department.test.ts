import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as managerRoute from "@/app/api/departments/[id]/manager/route";
import * as departmentsRoute from "@/app/api/departments/route";
import * as approveReportRoute from "@/app/api/reports/[id]/approve/route";
import * as queueRoute from "@/app/api/reports/review-queue/route";
import * as submitRoute from "@/app/api/reports/[id]/submit/route";
import * as approveUserRoute from "@/app/api/users/[id]/approve/route";
import * as usersRoute from "@/app/api/users/route";
import { prisma } from "@/lib/db/prisma";
import { ensureItDepartment } from "@/lib/departments/service";
import { resolveMicrosoftSignIn } from "@/lib/users/access";
import { call, FIXTURE_WEEK, makePendingUser, makeUser, reportTotals, request, resetDatabase, signInAs } from "./helpers";

const ADMIN_EMAIL = "root@test.local";
const signInAdmin = async () => (await resolveMicrosoftSignIn({ email: ADMIN_EMAIL, name: "Root Admin" })).user;

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv("SUPER_ADMIN_EMAILS", ADMIN_EMAIL);
});
afterEach(() => vi.unstubAllEnvs());

describe("the IT department", () => {
  it("exists from the Super Admin's first sign-in, led by them, and is created only once", async () => {
    const admin = await signInAdmin();
    await signInAdmin();
    const departments = await prisma.department.findMany();
    expect(departments).toHaveLength(1);
    expect(departments[0]).toMatchObject({ name: "IT Department", code: "IT", managerId: admin.id });
    // The Super Admin stays above the departments.
    expect(admin).toMatchObject({ role: "SUPER_ADMIN", departmentId: null });

    signInAs(admin);
    const list = await call(departmentsRoute.GET, request("GET", "/api/departments"));
    expect(list.body.data[0]).toMatchObject({ ledBySuperAdmin: true, manager: { id: admin.id } });
  });

  it("takes the name it's given, and leaves an existing IT code alone", async () => {
    const admin = await makeUser("SUPER_ADMIN", null, null);
    const created = await ensureItDepartment(admin, "GORD IT Department");
    expect(created).toMatchObject({ name: "GORD IT Department", code: "IT" });

    await resetDatabase();
    const other = await makeUser("SUPER_ADMIN", null, null);
    await prisma.department.create({ data: { name: "Infra", code: "IT", color: "teal" } });
    expect(await ensureItDepartment(other)).toBeNull();
    expect(await prisma.department.count()).toBe(1);
  });

  it("has no Manager: nobody can be assigned or approved as one", async () => {
    const admin = await signInAdmin();
    const it = await prisma.department.findFirstOrThrow();
    signInAs(admin);

    const change = await call(
      managerRoute.POST,
      request("POST", "/x", { body: { mode: "new", name: "New Manager", email: "manager@test.local" } }),
      { id: it.id },
    );
    expect(change.status).toBe(400);
    expect(await prisma.user.count({ where: { email: "manager@test.local" } })).toBe(0);

    const waiting = await makePendingUser();
    const approval = await call(
      approveUserRoute.POST,
      request("POST", "/x", { body: { role: "MANAGER", departmentId: it.id } }),
      { id: waiting.id },
    );
    expect(approval.status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: waiting.id } })).approval).toBe("PENDING");
    expect((await prisma.department.findUniqueOrThrow({ where: { id: it.id } })).managerId).toBe(admin.id);
  });

  it("sends a developer's week to the Team Lead, then to the Super Admin for final approval", async () => {
    const admin = await signInAdmin();
    const it = await prisma.department.findFirstOrThrow();
    signInAs(admin);

    const addLead = await call(
      usersRoute.POST,
      request("POST", "/x", { body: { name: "Lena Lead", email: "lead@test.local", role: "TEAM_LEAD", departmentId: it.id } }),
    );
    expect(addLead.status).toBe(201);
    const lead = await prisma.user.findUniqueOrThrow({ where: { email: "lead@test.local" } });
    expect(lead.reportsTo).toBe(admin.id);

    const developer = await makeUser("DEVELOPER", it.id, lead.id);
    const project = await prisma.project.create({
      data: { departmentId: it.id, name: "Portal", code: "PRT", color: "teal", ownerId: lead.id, createdBy: lead.id },
    });
    const report = await prisma.weeklyReport.create({
      data: { userId: developer.id, departmentId: it.id, ...FIXTURE_WEEK, ...reportTotals(project.id, 8) },
    });
    const act = (route: { POST: typeof submitRoute.POST }) =>
      call(route.POST, request("POST", "/x", { body: {} }), { id: report.id });
    const current = () => prisma.weeklyReport.findUniqueOrThrow({ where: { id: report.id } });

    signInAs(developer);
    expect((await act(submitRoute)).status).toBe(200);
    signInAs(lead);
    expect((await act(approveReportRoute)).status).toBe(200);
    expect(await current()).toMatchObject({ status: "LEAD_APPROVED", currentApproverId: admin.id });

    signInAs(admin);
    const queue = await call(queueRoute.GET, request("GET", "/api/reports/review-queue"));
    expect(queue.body.data.map((item: { id: string }) => item.id)).toEqual([report.id]);
    expect((await act(approveReportRoute)).status).toBe(200);
    expect(await current()).toMatchObject({ status: "MANAGER_APPROVED", currentApproverId: null });
  });
});

describe("projects in the IT department", () => {
  it("lets the Super Admin add and manage them, but not another department's", async () => {
    const projectsRoute = await import("@/app/api/projects/route");
    const projectRoute = await import("@/app/api/projects/[id]/route");
    const admin = await signInAdmin();
    const it = await prisma.department.findFirstOrThrow();
    const lead = await makeUser("TEAM_LEAD", it.id, admin.id);
    signInAs(admin);

    const created = await call(
      projectsRoute.POST,
      request("POST", "/x", { body: { name: "Portal", code: "PRT", color: "teal", memberIds: [lead.id] } }),
    );
    expect(created.status).toBe(201);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(project).toMatchObject({ departmentId: it.id, ownerId: admin.id });

    const renamed = await call(projectRoute.PATCH, request("PATCH", "/x", { body: { name: "Portal 2" } }), {
      id: project.id,
    });
    expect(renamed.status).toBe(200);

    const hr = await prisma.department.create({ data: { name: "HR", code: "HR", color: "teal" } });
    const manager = await makeUser("MANAGER", hr.id, null);
    const theirs = await prisma.project.create({
      data: { departmentId: hr.id, name: "Hiring", code: "HIR", color: "teal", ownerId: manager.id, createdBy: manager.id },
    });
    const refused = await call(projectRoute.PATCH, request("PATCH", "/x", { body: { name: "Mine now" } }), {
      id: theirs.id,
    });
    expect(refused.status).toBe(403);
  });

  it("gives a Super Admin who leads no department nothing to add to", async () => {
    const projectsRoute = await import("@/app/api/projects/route");
    const admin = await makeUser("SUPER_ADMIN", null, null);
    signInAs(admin);
    const created = await call(
      projectsRoute.POST,
      request("POST", "/x", { body: { name: "Portal", code: "PRT", color: "teal" } }),
    );
    expect(created.status).toBe(403);
  });
});
