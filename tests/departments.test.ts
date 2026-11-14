import { beforeEach, describe, expect, it, vi } from "vitest";
import * as departmentsRoute from "@/app/api/departments/route";
import * as departmentRoute from "@/app/api/departments/[id]/route";
import * as archiveRoute from "@/app/api/departments/[id]/archive/route";
import * as restoreRoute from "@/app/api/departments/[id]/restore/route";
import * as managerRoute from "@/app/api/departments/[id]/manager/route";
import { sendEmailSafely } from "@/lib/email";
import { AuditLog, Department, Notification, User, WeeklyReport } from "@/models";
import { call, makeCompany, makeUser, request, resetDatabase, signInAs } from "./helpers";

type Company = Awaited<ReturnType<typeof makeCompany>>;

const newDepartment = (manager: object, overrides: object = {}) => ({
  name: "Operations",
  code: "ops",
  description: "Runs the offices.",
  color: "sky",
  manager,
  ...overrides,
});

const post = (body: unknown) =>
  call(departmentsRoute.POST, request("POST", "/api/departments", { body }));

describe("Add Department", () => {
  let company: Company;

  beforeEach(async () => {
    await resetDatabase();
    vi.mocked(sendEmailSafely).mockClear();
    company = await makeCompany();
    signInAs(company.ceo);
  });

  it("assigns an existing unassigned manager and notifies them", async () => {
    const manager = await makeUser("MANAGER", null, company.ceo._id, "Free Manager");
    const { status, body } = await post(
      newDepartment({ mode: "existing", userId: String(manager._id) }),
    );
    expect(status).toBe(201);

    const department = await Department.findById(body.data.id).lean();
    expect(department?.code).toBe("OPS");
    expect(String(department?.managerId)).toBe(String(manager._id));
    expect(String((await User.findById(manager._id).lean())?.departmentId)).toBe(body.data.id);

    const notification = await Notification.findOne({ recipientId: manager._id }).lean();
    expect(notification?.type).toBe("DEPARTMENT_ASSIGNED");
    expect(String(notification?.departmentId)).toBe(body.data.id);
    expect(sendEmailSafely).toHaveBeenCalledOnce();
    expect(await AuditLog.countDocuments({ action: "department.create" })).toBe(1);
  });

  it("creates a new manager inline and emails an invite, storing only the token's hash", async () => {
    const { status, body } = await post(
      newDepartment({ mode: "new", name: "New Boss", email: "Boss@Test.local" }),
    );
    expect(status).toBe(201);

    const manager = await User.findOne({ email: "boss@test.local" })
      .select("+inviteTokenHash +passwordHash")
      .lean();
    expect(manager?.role).toBe("MANAGER");
    expect(String(manager?.departmentId)).toBe(body.data.id);
    expect(String(manager?.reportsTo)).toBe(String(company.ceo._id));
    expect(manager?.passwordHash).toBeNull();
    expect(manager?.inviteTokenHash).toMatch(/^[a-f\d]{64}$/);

    const mail = vi.mocked(sendEmailSafely).mock.calls[0]![0];
    expect(mail.to).toBe("boss@test.local");
    const token = /\/invite\/([a-f\d]{64})/.exec(mail.text)![1]!;
    expect(token).not.toBe(manager?.inviteTokenHash);
  });

  it.each([
    ["a manager who already has a department", (c: Company) => String(c.it.manager._id)],
    ["someone who isn't a manager", (c: Company) => String(c.it.developer._id)],
  ])("refuses %s", async (_label, userId) => {
    const { status } = await post(newDepartment({ mode: "existing", userId: userId(company) }));
    expect(status).toBe(400);
    expect(await Department.countDocuments()).toBe(2);
  });

  it("refuses a deactivated manager", async () => {
    const manager = await makeUser("MANAGER", null, company.ceo._id);
    await User.updateOne({ _id: manager._id }, { isActive: false });
    const { status } = await post(
      newDepartment({ mode: "existing", userId: String(manager._id) }),
    );
    expect(status).toBe(400);
  });

  it.each([
    ["name, in any case", { name: "it", code: "NEWCODE" }],
    ["code", { name: "Brand New", code: "HR" }],
  ])("refuses a duplicate %s and leaves no orphan manager behind", async (_label, overrides) => {
    const { status } = await post(
      newDepartment({ mode: "new", name: "Orphan", email: "orphan@test.local" }, overrides),
    );
    expect(status).toBe(409);
    expect(await User.exists({ email: "orphan@test.local" })).toBeNull();
  });

  it("refuses an email that's already in use", async () => {
    const { status, body } = await post(
      newDepartment({ mode: "new", name: "Copy", email: company.it.lead.email }),
    );
    expect(status).toBe(409);
    expect(body.error.code).toBe("EMAIL_TAKEN");
  });

  it("validates input with the shared schema", async () => {
    const { status, body } = await post(
      newDepartment({ mode: "new", name: "X", email: "nope" }, { code: "bad code!" }),
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("the database itself rejects two departments with one manager", async () => {
    await expect(
      Department.create({
        name: "Second",
        code: "SECOND",
        color: "teal",
        managerId: company.it.manager._id,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe("managing a department", () => {
  let company: Company;

  beforeEach(async () => {
    await resetDatabase();
    vi.mocked(sendEmailSafely).mockClear();
    company = await makeCompany();
    signInAs(company.ceo);
  });

  const id = () => String(company.it.department._id);

  it("changing the manager moves team leads and open reviews, and frees the old manager", async () => {
    const next = await makeUser("MANAGER", null, company.ceo._id, "Next Manager");
    await WeeklyReport.updateOne(
      { _id: company.it.report._id },
      { status: "LEAD_APPROVED", currentApproverId: company.it.manager._id },
    );

    const { status } = await call(
      managerRoute.POST,
      request("POST", `/api/departments/${id()}/manager`, {
        body: { mode: "existing", userId: String(next._id) },
      }),
      { id: id() },
    );
    expect(status).toBe(200);

    const department = await Department.findById(id()).lean();
    expect(String(department?.managerId)).toBe(String(next._id));
    expect(String((await User.findById(next._id).lean())?.departmentId)).toBe(id());
    expect(String((await User.findById(company.it.lead._id).lean())?.reportsTo)).toBe(
      String(next._id),
    );
    expect((await User.findById(company.it.manager._id).lean())?.departmentId).toBeNull();
    expect(String((await WeeklyReport.findById(company.it.report._id).lean())?.currentApproverId)).toBe(
      String(next._id),
    );
    expect(await Notification.exists({ recipientId: company.it.manager._id, type: "DEPARTMENT_UNASSIGNED" })).toBeTruthy();
    expect(await Notification.exists({ recipientId: next._id, type: "DEPARTMENT_ASSIGNED" })).toBeTruthy();
  });

  it("the previous manager immediately loses access to the department", async () => {
    const next = await makeUser("MANAGER", null, company.ceo._id);
    await call(
      managerRoute.POST,
      request("POST", `/api/departments/${id()}/manager`, {
        body: { mode: "existing", userId: String(next._id) },
      }),
      { id: id() },
    );
    signInAs(company.it.manager);
    const { status } = await call(
      departmentRoute.GET,
      request("GET", `/api/departments/${id()}`),
      { id: id() },
    );
    expect(status).toBe(404);
  });

  it("archives and restores", async () => {
    const archived = await call(archiveRoute.POST, request("POST", "/x"), { id: id() });
    expect(archived.body.data.status).toBe("Archived");
    const restored = await call(restoreRoute.POST, request("POST", "/x"), { id: id() });
    expect(restored.body.data.status).toBe("Active");
  });

  it("won't change the manager of an archived department", async () => {
    await call(archiveRoute.POST, request("POST", "/x"), { id: id() });
    const next = await makeUser("MANAGER", null, company.ceo._id);
    const { status } = await call(
      managerRoute.POST,
      request("POST", "/x", { body: { mode: "existing", userId: String(next._id) } }),
      { id: id() },
    );
    expect(status).toBe(400);
  });

  it("refuses to delete a department with data", async () => {
    const { status, body } = await call(departmentRoute.DELETE, request("DELETE", "/x"), {
      id: id(),
    });
    expect(status).toBe(409);
    expect(body.error.code).toBe("DEPARTMENT_HAS_DATA");
    expect(await Department.exists({ _id: id() })).toBeTruthy();
  });

  it("deletes an empty department and frees its manager", async () => {
    const created = await post(
      newDepartment({ mode: "new", name: "Short Lived", email: "short@test.local" }),
    );
    const { status } = await call(departmentRoute.DELETE, request("DELETE", "/x"), {
      id: created.body.data.id,
    });
    expect(status).toBe(200);
    expect((await User.findOne({ email: "short@test.local" }).lean())?.departmentId).toBeNull();
  });

  it("reports stats and leaves other departments out of them", async () => {
    const { body } = await call(departmentsRoute.GET, request("GET", "/api/departments"));
    const it_ = body.data.find((row: { code: string }) => row.code === "IT");
    expect(it_).toMatchObject({ headcount: 4, activeProjects: 1 });
    expect(it_.manager.id).toBe(String(company.it.manager._id));
  });
});
