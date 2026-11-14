import { beforeEach, describe, expect, it, vi } from "vitest";
import * as acceptRoute from "@/app/api/auth/invite/accept/route";
import * as usersRoute from "@/app/api/users/route";
import * as userRoute from "@/app/api/users/[id]/route";
import { verifyPassword } from "@/lib/auth/password";
import { sendEmailSafely } from "@/lib/email";
import { Project, User, WeeklyReport } from "@/models";
import { call, makeCompany, makeUser, request, resetDatabase, signInAs } from "./helpers";

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
        departmentId: String(company.it.department._id),
        reportsTo: String(company.it.lead._id),
      });
      expect(status).toBe(201);
      expect(sendEmailSafely).toHaveBeenCalledOnce();
    });

    it("refuses a developer reporting to a lead in another department", async () => {
      const { status } = await create({
        ...person,
        role: "DEVELOPER",
        departmentId: String(company.it.department._id),
        reportsTo: String(company.hr.lead._id),
      });
      expect(status).toBe(400);
    });

    it("refuses a developer reporting straight to a manager", async () => {
      const { status } = await create({
        ...person,
        role: "DEVELOPER",
        departmentId: String(company.it.department._id),
        reportsTo: String(company.it.manager._id),
      });
      expect(status).toBe(400);
    });

    it("points a team lead at their department's manager automatically", async () => {
      const { body } = await create({
        ...person,
        role: "TEAM_LEAD",
        departmentId: String(company.hr.department._id),
      });
      const lead = await User.findById(body.data.id).lean();
      expect(String(lead?.reportsTo)).toBe(String(company.hr.manager._id));
    });

    it("refuses a team lead assigned to another department's manager", async () => {
      const { status } = await create({
        ...person,
        role: "TEAM_LEAD",
        departmentId: String(company.hr.department._id),
        reportsTo: String(company.it.manager._id),
      });
      expect(status).toBe(400);
    });

    it("creates a manager unassigned and reporting to the CEO", async () => {
      const { body } = await create({ ...person, role: "MANAGER" });
      const manager = await User.findById(body.data.id).lean();
      expect(manager?.departmentId).toBeNull();
      expect(String(manager?.reportsTo)).toBe(String(company.ceo._id));
    });

    it("won't give a manager a department directly, which would bypass one-per-department", async () => {
      const { status } = await create({
        ...person,
        role: "MANAGER",
        departmentId: String(company.it.department._id),
      });
      expect(status).toBe(400);
    });

    it("won't create a second CEO", async () => {
      expect((await create({ ...person, role: "CEO" })).status).toBe(400);
    });

    it("won't add anyone to an archived department", async () => {
      await company.it.department.updateOne({ status: "Archived" });
      const { status } = await create({
        ...person,
        role: "TEAM_LEAD",
        departmentId: String(company.it.department._id),
      });
      expect(status).toBe(400);
    });
  });

  describe("moving between departments", () => {
    it("requires re-pointing reportsTo", async () => {
      const { status } = await patch(company.it.otherDeveloper._id, {
        departmentId: String(company.hr.department._id),
      });
      expect(status).toBe(400);
      const unchanged = await User.findById(company.it.otherDeveloper._id).lean();
      expect(String(unchanged?.departmentId)).toBe(String(company.it.department._id));
    });

    it("moves the user, leaves old projects, and keeps past reports in the old department", async () => {
      const { developer } = company.it;
      const { status } = await patch(developer._id, {
        departmentId: String(company.hr.department._id),
        reportsTo: String(company.hr.lead._id),
      });
      expect(status).toBe(200);

      const moved = await User.findById(developer._id).lean();
      expect(String(moved?.departmentId)).toBe(String(company.hr.department._id));
      expect(String(moved?.reportsTo)).toBe(String(company.hr.lead._id));
      const project = await Project.findById(company.it.project._id).lean();
      expect(project?.memberIds.map(String)).not.toContain(String(developer._id));
      const report = await WeeklyReport.findById(company.it.report._id).lean();
      expect(String(report?.departmentId)).toBe(String(company.it.department._id));
    });

    it("the moved user loses access to their old department at once", async () => {
      const { developer } = company.it;
      await patch(developer._id, {
        departmentId: String(company.hr.department._id),
        reportsTo: String(company.hr.lead._id),
      });
      signInAs(developer);
      const old = String(company.it.lead._id);
      const { status } = await call(userRoute.GET, request("GET", `/api/users/${old}`), { id: old });
      expect(status).toBe(404);
    });
  });

  describe("protecting the chain", () => {
    it("won't move or deactivate someone who still has direct reports", async () => {
      const move = await patch(company.it.lead._id, {
        departmentId: String(company.hr.department._id),
      });
      expect(move.status).toBe(409);
      expect(move.body.error.code).toBe("HAS_DIRECT_REPORTS");
      const deactivate = await patch(company.it.lead._id, { isActive: false });
      expect(deactivate.body.error.code).toBe("HAS_DIRECT_REPORTS");
    });

    it("won't change or deactivate a department's current manager", async () => {
      const role = await patch(company.it.manager._id, { role: "DEVELOPER" });
      expect(role.body.error.code).toBe("IS_DEPARTMENT_MANAGER");
      const deactivate = await patch(company.it.manager._id, { isActive: false });
      expect(deactivate.body.error.code).toBe("IS_DEPARTMENT_MANAGER");
    });

    it("won't change the CEO's role or activate state", async () => {
      expect((await patch(company.ceo._id, { isActive: false })).status).toBe(400);
      expect((await patch(company.ceo._id, { role: "MANAGER" })).status).toBe(400);
    });

    it("promotes a developer to team lead and repoints them to the manager", async () => {
      const { status } = await patch(company.it.otherDeveloper._id, { role: "TEAM_LEAD" });
      expect(status).toBe(200);
      const promoted = await User.findById(company.it.otherDeveloper._id).lean();
      expect(promoted?.role).toBe("TEAM_LEAD");
      expect(String(promoted?.reportsTo)).toBe(String(company.it.manager._id));
    });

    it("deactivated users lose API access on their next request", async () => {
      await patch(company.it.otherDeveloper._id, { isActive: false });
      signInAs(company.it.otherDeveloper);
      const id = String(company.it.otherDeveloper._id);
      const { status } = await call(userRoute.GET, request("GET", `/api/users/${id}`), { id });
      expect(status).toBe(401);
    });
  });

  describe("accepting an invite", () => {
    async function invitedToken() {
      const manager = { name: "Invited", email: "invited@test.local", role: "MANAGER" };
      await create(manager);
      const mail = vi.mocked(sendEmailSafely).mock.calls[0]![0];
      return /\/invite\/([a-f\d]{64})/.exec(mail.text)![1]!;
    }
    const accept = (token: string, password = "a-long-password") =>
      call(
        acceptRoute.POST,
        request("POST", "/api/auth/invite/accept", {
          body: { token, password, confirmPassword: password },
        }),
      );

    it("sets a bcrypt password and can't be used twice", async () => {
      const token = await invitedToken();
      expect((await accept(token)).status).toBe(200);
      const user = await User.findOne({ email: "invited@test.local" })
        .select("+passwordHash +inviteTokenHash")
        .lean();
      expect(user?.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(await verifyPassword("a-long-password", user?.passwordHash)).toBe(true);
      expect(user?.inviteTokenHash).toBeNull();
      expect((await accept(token)).status).toBe(400);
    });

    it("rejects an expired token", async () => {
      const token = await invitedToken();
      await User.updateOne({ email: "invited@test.local" }, { inviteExpiresAt: new Date(0) });
      const { status, body } = await accept(token);
      expect(status).toBe(400);
      expect(body.error.code).toBe("INVALID_INVITE");
    });

    it("rejects a short password", async () => {
      expect((await accept(await invitedToken(), "short")).status).toBe(400);
    });
  });

  it("password verification rejects users without a password", async () => {
    await makeUser("DEVELOPER", null, null);
    expect(await verifyPassword("anything", null)).toBe(false);
  });
});
