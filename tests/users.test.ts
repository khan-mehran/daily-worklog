import { beforeEach, describe, expect, it, vi } from "vitest";
import * as usersRoute from "@/app/api/users/route";
import * as userRoute from "@/app/api/users/[id]/route";
import { sendEmailSafely } from "@/lib/email";
import { prisma } from "@/lib/db/prisma";
import { call, makeCompany, memberIdsOf, request, resetDatabase, signInAs } from "./helpers";

type Company = Awaited<ReturnType<typeof makeCompany>>;

describe("users and the reporting chain", () => {
  let company: Company;

  beforeEach(async () => {
    await resetDatabase();
    vi.mocked(sendEmailSafely).mockClear();
    company = await makeCompany();
    signInAs(company.ceo);
  });

  const create = (body: object) =>
    call(usersRoute.POST, request("POST", "/api/users", { body }));
  const patch = (id: unknown, body: object) =>
    call(userRoute.PATCH, request("PATCH", "/x", { body }), { id: String(id) });

  describe("creating", () => {
    const person = { name: "New Person", email: "new@test.local" };

    it("creates a developer under a team lead in the same department", async () => {
      const { status } = await create({
        ...person,
        role: "DEVELOPER",
        departmentId: company.it.department.id,
        reportsTo: company.it.lead.id,
      });
      expect(status).toBe(201);
      expect(sendEmailSafely).toHaveBeenCalledOnce();
    });

    it("refuses a developer reporting to a lead in another department", async () => {
      const { status } = await create({
        ...person,
        role: "DEVELOPER",
        departmentId: company.it.department.id,
        reportsTo: company.hr.lead.id,
      });
      expect(status).toBe(400);
    });

    it("refuses a developer reporting straight to a manager", async () => {
      const { status } = await create({
        ...person,
        role: "DEVELOPER",
        departmentId: company.it.department.id,
        reportsTo: company.it.manager.id,
      });
      expect(status).toBe(400);
    });

    it("points a team lead at their department's manager automatically", async () => {
      const { body } = await create({
        ...person,
        role: "TEAM_LEAD",
        departmentId: company.hr.department.id,
      });
      const lead = await prisma.user.findUnique({ where: { id: body.data.id } });
      expect(String(lead?.reportsTo)).toBe(company.hr.manager.id);
    });

    it("refuses a team lead assigned to another department's manager", async () => {
      const { status } = await create({
        ...person,
        role: "TEAM_LEAD",
        departmentId: company.hr.department.id,
        reportsTo: company.it.manager.id,
      });
      expect(status).toBe(400);
    });

    it("creates a manager unassigned and reporting to the CEO", async () => {
      const { body } = await create({ ...person, role: "MANAGER" });
      const manager = await prisma.user.findUnique({ where: { id: body.data.id } });
      expect(manager?.departmentId).toBeNull();
      expect(String(manager?.reportsTo)).toBe(company.ceo.id);
    });

    it("won't give a manager a department directly, which would bypass one-per-department", async () => {
      const { status } = await create({
        ...person,
        role: "MANAGER",
        departmentId: company.it.department.id,
      });
      expect(status).toBe(400);
    });

    it("won't create a second CEO", async () => {
      expect((await create({ ...person, role: "CEO" })).status).toBe(400);
    });

    it("won't add anyone to an archived department", async () => {
      await prisma.department.update({ where: { id: company.it.department.id }, data: { status: "Archived" } });
      const { status } = await create({
        ...person,
        role: "TEAM_LEAD",
        departmentId: company.it.department.id,
      });
      expect(status).toBe(400);
    });
  });

  describe("moving between departments", () => {
    it("requires re-pointing reportsTo", async () => {
      const { status } = await patch(company.it.otherDeveloper.id, {
        departmentId: company.hr.department.id,
      });
      expect(status).toBe(400);
      const unchanged = await prisma.user.findUnique({ where: { id: company.it.otherDeveloper.id } });
      expect(String(unchanged?.departmentId)).toBe(company.it.department.id);
    });

    it("moves the user, leaves old projects, and keeps past reports in the old department", async () => {
      const { developer } = company.it;
      const { status } = await patch(developer.id, {
        departmentId: company.hr.department.id,
        reportsTo: company.hr.lead.id,
      });
      expect(status).toBe(200);

      const moved = await prisma.user.findUnique({ where: { id: developer.id } });
      expect(String(moved?.departmentId)).toBe(company.hr.department.id);
      expect(String(moved?.reportsTo)).toBe(company.hr.lead.id);
      expect(await memberIdsOf(company.it.project.id)).not.toContain(developer.id);
      const report = await prisma.weeklyReport.findUnique({ where: { id: company.it.report.id } });
      expect(String(report?.departmentId)).toBe(company.it.department.id);
    });

    it("the moved user loses access to their old department at once", async () => {
      const { developer } = company.it;
      await patch(developer.id, {
        departmentId: company.hr.department.id,
        reportsTo: company.hr.lead.id,
      });
      signInAs(developer);
      const old = company.it.lead.id;
      const { status } = await call(userRoute.GET, request("GET", `/api/users/${old}`), { id: old });
      expect(status).toBe(404);
    });
  });

  describe("protecting the chain", () => {
    it("won't move or deactivate someone who still has direct reports", async () => {
      const move = await patch(company.it.lead.id, {
        departmentId: company.hr.department.id,
      });
      expect(move.status).toBe(409);
      expect(move.body.error.code).toBe("HAS_DIRECT_REPORTS");
      const deactivate = await patch(company.it.lead.id, { isActive: false });
      expect(deactivate.body.error.code).toBe("HAS_DIRECT_REPORTS");
    });

    it("won't change or deactivate a department's current manager", async () => {
      const role = await patch(company.it.manager.id, { role: "DEVELOPER" });
      expect(role.body.error.code).toBe("IS_DEPARTMENT_MANAGER");
      const deactivate = await patch(company.it.manager.id, { isActive: false });
      expect(deactivate.body.error.code).toBe("IS_DEPARTMENT_MANAGER");
    });

    it("won't change the CEO's role or activate state", async () => {
      expect((await patch(company.ceo.id, { isActive: false })).status).toBe(400);
      expect((await patch(company.ceo.id, { role: "MANAGER" })).status).toBe(400);
    });

    it("promotes a developer to team lead and repoints them to the manager", async () => {
      const { status } = await patch(company.it.otherDeveloper.id, { role: "TEAM_LEAD" });
      expect(status).toBe(200);
      const promoted = await prisma.user.findUnique({ where: { id: company.it.otherDeveloper.id } });
      expect(promoted?.role).toBe("TEAM_LEAD");
      expect(String(promoted?.reportsTo)).toBe(company.it.manager.id);
    });

    it("deactivated users lose API access on their next request", async () => {
      await patch(company.it.otherDeveloper.id, { isActive: false });
      signInAs(company.it.otherDeveloper);
      const id = company.it.otherDeveloper.id;
      const { status } = await call(userRoute.GET, request("GET", `/api/users/${id}`), { id });
      expect(status).toBe(401);
    });
  });

  it("emails someone added ahead of time to sign in with Microsoft, already approved", async () => {
    const { body } = await create({ name: "Added Early", email: "early@test.local", role: "MANAGER" });
    const user = await prisma.user.findUnique({ where: { id: body.data.id } });
    expect(user?.approval).toBe("APPROVED");
    const mail = vi.mocked(sendEmailSafely).mock.calls[0]![0];
    expect(mail.to).toBe("early@test.local");
    expect(mail.text).toContain("Sign in with your Microsoft account");
  });

});
