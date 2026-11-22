import { format } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as departmentsRoute from "@/app/api/departments/route";
import * as meRoute from "@/app/api/me/route";
import * as tasksRoute from "@/app/api/tasks/route";
import * as teamRoute from "@/app/api/team/route";
import * as usersRoute from "@/app/api/users/route";
import * as userRoute from "@/app/api/users/[id]/route";
import * as approveRoute from "@/app/api/users/[id]/approve/route";
import * as rejectRoute from "@/app/api/users/[id]/reject/route";
import { prisma } from "@/lib/db/prisma";
import { sendEmailSafely } from "@/lib/email";
import { resolveMicrosoftSignIn, superAdminEmails } from "@/lib/users/access";
import { call, makeCompany, makePendingUser, makeUser, request, resetDatabase, signInAs } from "./helpers";

type Company = Awaited<ReturnType<typeof makeCompany>>;
let company: Company;
let admin: Awaited<ReturnType<typeof makeUser>>;

const approve = (id: string, body: object) =>
  call(approveRoute.POST, request("POST", "/x", { body }), { id });
const reject = (id: string) => call(rejectRoute.POST, request("POST", "/x"), { id });
const patch = (id: string, body: object) => call(userRoute.PATCH, request("PATCH", "/x", { body }), { id });
const find = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });
const emailedTo = () => vi.mocked(sendEmailSafely).mock.calls.map((args) => args[0].to);

beforeEach(async () => {
  await resetDatabase();
  company = await makeCompany();
  admin = await makeUser("SUPER_ADMIN", null, null, "Root Admin");
  await prisma.notification.deleteMany();
  vi.mocked(sendEmailSafely).mockClear();
  vi.stubEnv("SUPER_ADMIN_EMAILS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("signing in with Microsoft", () => {
  it("creates a waiting account on a first sign-in and tells the Super Admins", async () => {
    const { user, outcome } = await resolveMicrosoftSignIn({ email: "New.Person@Test.local", name: "New Person" });
    expect(outcome).toBe("pending");
    expect(user).toMatchObject({ email: "new.person@test.local", approval: "PENDING", departmentId: null });

    const notes = await prisma.notification.findMany({ where: { type: "USER_PENDING" } });
    expect(notes.map((note) => note.recipientId)).toEqual([admin.id]);
    expect(notes[0]?.link).toBe("/users?status=PENDING");
    expect(emailedTo()).toEqual([admin.email]);
  });

  it("keeps them waiting on later attempts, without telling anyone again", async () => {
    await resolveMicrosoftSignIn({ email: "new@test.local", name: "New Person" });
    vi.mocked(sendEmailSafely).mockClear();
    const again = await resolveMicrosoftSignIn({ email: "NEW@test.local", name: "New Person" });
    expect(again.outcome).toBe("pending");
    expect(await prisma.user.count({ where: { email: "new@test.local" } })).toBe(1);
    expect(sendEmailSafely).not.toHaveBeenCalled();
  });

  it("gives a waiting person no access to the API, even with a session", async () => {
    const waiting = await makePendingUser();
    signInAs(waiting);
    expect((await call(meRoute.GET, request("GET", "/api/me"))).status).toBe(401);
  });

  it("signs in someone who is approved, and turns away the rejected and the deactivated", async () => {
    const approved = await resolveMicrosoftSignIn({ email: company.it.developer.email, name: "x" });
    expect(approved.outcome).toBe("signed-in");
    expect(approved.user.id).toBe(company.it.developer.id);

    await prisma.user.update({ where: { id: company.it.developer.id }, data: { approval: "REJECTED" } });
    expect((await resolveMicrosoftSignIn({ email: company.it.developer.email, name: "x" })).outcome).toBe("rejected");

    await prisma.user.update({ where: { id: company.it.lead.id }, data: { isActive: false } });
    expect((await resolveMicrosoftSignIn({ email: company.it.lead.email, name: "x" })).outcome).toBe("inactive");
  });

  describe("SUPER_ADMIN_EMAILS", () => {
    beforeEach(() => vi.stubEnv("SUPER_ADMIN_EMAILS", "Owner@Test.local, second@test.local"));

    it("reads a list of emails, whatever their case or separator", () => {
      expect(superAdminEmails()).toEqual(["owner@test.local", "second@test.local"]);
      vi.stubEnv("SUPER_ADMIN_EMAILS", "");
      expect(superAdminEmails()).toEqual([]);
    });

    it("makes a listed person a Super Admin on their first sign-in, with no waiting", async () => {
      const { user, outcome } = await resolveMicrosoftSignIn({ email: "owner@test.local", name: "The Owner" });
      expect(outcome).toBe("signed-in");
      expect(user).toMatchObject({ role: "SUPER_ADMIN", approval: "APPROVED", name: "The Owner" });
      expect(sendEmailSafely).not.toHaveBeenCalled();
    });

    it("lets a listed person back in even if their account was rejected or deactivated", async () => {
      await prisma.user.create({
        data: { name: "Owner", email: "owner@test.local", role: "DEVELOPER", approval: "REJECTED", isActive: false },
      });
      const { user, outcome } = await resolveMicrosoftSignIn({ email: "owner@test.local", name: "Owner" });
      expect(outcome).toBe("signed-in");
      expect(user).toMatchObject({ role: "SUPER_ADMIN", approval: "APPROVED", isActive: true });
    });

    it("doesn't take a listed person out of a role others depend on", async () => {
      vi.stubEnv("SUPER_ADMIN_EMAILS", company.it.manager.email);
      const { user, outcome } = await resolveMicrosoftSignIn({ email: company.it.manager.email, name: "x" });
      expect(outcome).toBe("signed-in");
      expect(user.role).toBe("MANAGER");
    });
  });
});

describe("approving", () => {
  let waiting: Awaited<ReturnType<typeof makePendingUser>>;
  beforeEach(async () => {
    waiting = await makePendingUser("Asha Rao");
    signInAs(admin);
  });

  it("places a Developer in a department under a Team Lead, and emails them", async () => {
    const { status, body } = await approve(waiting.id, {
      role: "DEVELOPER",
      departmentId: company.it.department.id,
      reportsTo: company.it.lead.id,
    });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ approval: "APPROVED", role: "DEVELOPER" });
    expect(await find(waiting.id)).toMatchObject({
      approval: "APPROVED",
      role: "DEVELOPER",
      departmentId: company.it.department.id,
      reportsTo: company.it.lead.id,
    });

    const mail = vi.mocked(sendEmailSafely).mock.calls[0]![0];
    expect(mail.to).toBe(waiting.email);
    expect(mail.subject).toBe("Your GET List access is approved");
    expect(mail.text).toContain("Developer in IT");
    expect(await prisma.auditLog.count({ where: { action: "user.approve", targetId: waiting.id } })).toBe(1);

    expect((await resolveMicrosoftSignIn({ email: waiting.email, name: "x" })).outcome).toBe("signed-in");
  });

  it("points a Team Lead at the department's Manager", async () => {
    await approve(waiting.id, { role: "TEAM_LEAD", departmentId: company.hr.department.id });
    expect(await find(waiting.id)).toMatchObject({
      role: "TEAM_LEAD",
      departmentId: company.hr.department.id,
      reportsTo: company.hr.manager.id,
    });
  });

  it("refuses a Developer or Team Lead with no department, and leaves them waiting", async () => {
    expect((await approve(waiting.id, { role: "DEVELOPER" })).status).toBe(400);
    expect((await approve(waiting.id, { role: "TEAM_LEAD" })).status).toBe(400);
    expect(
      (await approve(waiting.id, { role: "DEVELOPER", departmentId: company.it.department.id })).status,
    ).toBe(400);
    expect((await find(waiting.id)).approval).toBe("PENDING");
    expect(sendEmailSafely).not.toHaveBeenCalled();
  });

  it("approves a Manager with no department yet, reporting to the CEO", async () => {
    await approve(waiting.id, { role: "MANAGER" });
    expect(await find(waiting.id)).toMatchObject({
      role: "MANAGER",
      departmentId: null,
      reportsTo: company.ceo.id,
      approval: "APPROVED",
    });
  });

  it("makes a Manager the manager of the chosen department, unassigning the previous one", async () => {
    const { status } = await approve(waiting.id, { role: "MANAGER", departmentId: company.it.department.id });
    expect(status).toBe(200);
    expect(await find(waiting.id)).toMatchObject({ role: "MANAGER", departmentId: company.it.department.id });
    const department = await prisma.department.findUniqueOrThrow({ where: { id: company.it.department.id } });
    expect(department.managerId).toBe(waiting.id);
    expect((await find(company.it.manager.id)).departmentId).toBeNull();
    expect((await find(company.it.lead.id)).reportsTo).toBe(waiting.id);
  });

  it("refuses an archived or unknown department for a Manager, and leaves them waiting", async () => {
    await prisma.department.update({ where: { id: company.hr.department.id }, data: { status: "Archived" } });
    expect((await approve(waiting.id, { role: "MANAGER", departmentId: company.hr.department.id })).status).toBe(400);
    expect((await find(waiting.id)).approval).toBe("PENDING");
  });

  it("can't be done twice", async () => {
    await approve(waiting.id, { role: "MANAGER" });
    const again = await approve(waiting.id, { role: "MANAGER" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_APPROVED");
  });

  it("lets the CEO approve into departments, but only a Super Admin hand out the top roles", async () => {
    signInAs(company.ceo);
    expect((await approve(waiting.id, { role: "SUPER_ADMIN" })).status).toBe(403);
    expect((await approve(waiting.id, { role: "CEO" })).status).toBe(403);
    expect((await find(waiting.id)).approval).toBe("PENDING");
    expect((await approve(waiting.id, { role: "MANAGER" })).status).toBe(200);
  });

  it("a Super Admin can approve another Super Admin, who is then emailed", async () => {
    expect((await approve(waiting.id, { role: "SUPER_ADMIN" })).status).toBe(200);
    expect(await find(waiting.id)).toMatchObject({ role: "SUPER_ADMIN", departmentId: null, reportsTo: null });
    expect(emailedTo()).toEqual([waiting.email]);
  });

  it("won't approve a second CEO", async () => {
    const { status, body } = await approve(waiting.id, { role: "CEO" });
    expect(status).toBe(409);
    expect(body.error.code).toBe("CEO_EXISTS");
    expect((await find(waiting.id)).approval).toBe("PENDING");
  });

  it.each(["manager", "lead", "developer"] as const)("is hidden from a %s: the person is a 404", async (key) => {
    signInAs(company.it[key]);
    expect((await approve(waiting.id, { role: "MANAGER" })).status).toBe(404);
    expect((await reject(waiting.id)).status).toBe(404);
    expect((await find(waiting.id)).approval).toBe("PENDING");
  });

  it("is a 403 for a Manager acting on someone in their own department", async () => {
    signInAs(company.it.manager);
    expect((await approve(company.it.developer.id, { role: "MANAGER" })).status).toBe(403);
    expect((await reject(company.it.developer.id)).status).toBe(403);
  });
});

describe("rejecting", () => {
  it("turns a waiting person away, and they can still be approved later", async () => {
    const waiting = await makePendingUser();
    signInAs(admin);
    const { status, body } = await reject(waiting.id);
    expect(status).toBe(200);
    expect(body.data.approval).toBe("REJECTED");
    expect((await resolveMicrosoftSignIn({ email: waiting.email, name: "x" })).outcome).toBe("rejected");
    expect(await prisma.auditLog.count({ where: { action: "user.reject" } })).toBe(1);

    expect((await reject(waiting.id)).status).toBe(409);
    expect((await approve(waiting.id, { role: "MANAGER" })).status).toBe(200);
    expect((await find(waiting.id)).approval).toBe("APPROVED");
  });

  it("isn't how you remove someone who is already in", async () => {
    signInAs(admin);
    expect((await reject(company.it.developer.id)).status).toBe(409);
    expect((await find(company.it.developer.id)).approval).toBe("APPROVED");
  });
});

describe("the users list", () => {
  it("shows people waiting first, and filters by status, for those who manage users", async () => {
    const waiting = await makePendingUser("Zed Last");
    signInAs(admin);
    const all = await call(usersRoute.GET, request("GET", "/api/users?limit=100"));
    expect(all.body.data[0]).toMatchObject({ id: waiting.id, approval: "PENDING" });
    const pending = await call(usersRoute.GET, request("GET", "/api/users?approval=PENDING"));
    expect(pending.body.data.map((row: { id: string }) => row.id)).toEqual([waiting.id]);
    expect(pending.body.meta.total).toBe(1);
  });

  it("never shows waiting or rejected people to anyone else, whatever they ask for", async () => {
    await prisma.user.update({ where: { id: company.it.otherDeveloper.id }, data: { approval: "REJECTED" } });
    signInAs(company.it.manager);
    for (const query of ["?limit=100", "?approval=REJECTED", "?approval=PENDING"]) {
      const { body } = await call(usersRoute.GET, request("GET", `/api/users${query}`));
      expect(body.data.every((row: { approval: string }) => row.approval === "APPROVED")).toBe(true);
      expect(body.data.map((row: { id: string }) => row.id)).not.toContain(company.it.otherDeveloper.id);
    }
  });

  it("leaves waiting people off the Team page", async () => {
    const waiting = await makePendingUser();
    signInAs(company.ceo);
    const { body } = await call(teamRoute.GET, request("GET", "/api/team?limit=100"));
    expect(body.data.map((row: { id: string }) => row.id)).not.toContain(waiting.id);
    expect(body.data.map((row: { id: string }) => row.id)).not.toContain(admin.id);
  });
});

describe("the Super Admin", () => {
  beforeEach(() => signInAs(admin));

  it("sees every department and can add one", async () => {
    const list = await call(departmentsRoute.GET, request("GET", "/api/departments"));
    expect(list.body.data.map((row: { name: string }) => row.name).sort()).toEqual(["HR", "IT"]);
    const created = await call(
      departmentsRoute.POST,
      request("POST", "/api/departments", {
        body: { name: "Finance", code: "FIN", color: "sky", manager: { mode: "new", name: "Fin Boss", email: "fin@test.local" } },
      }),
    );
    expect(created.status).toBe(201);
  });

  it("doesn't log tasks", async () => {
    const body = {
      projectId: company.it.project.id,
      details: "Should not be allowed",
      date: format(new Date(), "yyyy-MM-dd"),
    };
    expect((await call(tasksRoute.POST, request("POST", "/api/tasks", { body }))).status).toBe(403);
  });

  it("can't change their own role or deactivate themselves", async () => {
    expect((await patch(admin.id, { role: "DEVELOPER" })).status).toBe(400);
    expect((await patch(admin.id, { isActive: false })).status).toBe(400);
    expect((await patch(admin.id, { name: "Renamed Admin" })).status).toBe(200);
    expect(await find(admin.id)).toMatchObject({ role: "SUPER_ADMIN", isActive: true, name: "Renamed Admin" });
  });

  it("is out of reach of the CEO", async () => {
    signInAs(company.ceo);
    expect((await patch(admin.id, { isActive: false })).status).toBe(403);
    expect((await patch(admin.id, { role: "DEVELOPER" })).status).toBe(403);
    expect((await patch(company.it.otherDeveloper.id, { role: "SUPER_ADMIN" })).status).toBe(403);
    expect(await find(admin.id)).toMatchObject({ role: "SUPER_ADMIN", isActive: true });
  });

  it("hands the CEO role from one person to another, and the Managers follow", async () => {
    const successor = await makeUser("MANAGER", null, company.ceo.id, "Next Ceo");
    // A Manager's week that is waiting for the outgoing CEO.
    const waitingReport = await prisma.weeklyReport.create({
      data: {
        userId: company.it.manager.id,
        departmentId: company.it.department.id,
        isoYear: 2026,
        isoWeek: 2,
        weekStart: new Date("2026-01-05"),
        weekEnd: new Date("2026-01-11"),
        status: "SUBMITTED",
        currentApproverId: company.ceo.id,
      },
    });

    // There is one CEO: the role has to be freed first.
    expect((await patch(successor.id, { role: "CEO" })).body.error.code).toBe("CEO_EXISTS");

    expect((await patch(company.ceo.id, { role: "MANAGER" })).status).toBe(200);
    expect((await find(company.it.manager.id)).reportsTo).toBeNull();
    expect((await prisma.weeklyReport.findUniqueOrThrow({ where: { id: waitingReport.id } })).currentApproverId).toBeNull();

    expect((await patch(successor.id, { role: "CEO" })).status).toBe(200);
    expect(await find(successor.id)).toMatchObject({ role: "CEO", departmentId: null, reportsTo: null });
    expect((await find(company.it.manager.id)).reportsTo).toBe(successor.id);
    expect((await find(company.hr.manager.id)).reportsTo).toBe(successor.id);
    expect((await prisma.weeklyReport.findUniqueOrThrow({ where: { id: waitingReport.id } })).currentApproverId).toBe(successor.id);
  });
});
