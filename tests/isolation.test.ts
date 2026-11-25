import { readdirSync } from "node:fs";
import ExcelJS from "exceljs";
import { join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEPARTMENT_FILTER_COOKIE, type Role } from "@/lib/constants";
import * as departmentsRoute from "@/app/api/departments/route";
import * as departmentRoute from "@/app/api/departments/[id]/route";
import * as archiveRoute from "@/app/api/departments/[id]/archive/route";
import * as restoreRoute from "@/app/api/departments/[id]/restore/route";
import * as managerRoute from "@/app/api/departments/[id]/manager/route";
import * as filterRoute from "@/app/api/me/department-filter/route";
import * as meRoute from "@/app/api/me/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectRoute from "@/app/api/projects/[id]/route";
import * as membersRoute from "@/app/api/projects/[id]/members/route";
import * as reportRoute from "@/app/api/reports/[id]/route";
import * as approveRoute from "@/app/api/reports/[id]/approve/route";
import * as changesRoute from "@/app/api/reports/[id]/request-changes/route";
import * as submitRoute from "@/app/api/reports/[id]/submit/route";
import * as queueRoute from "@/app/api/reports/review-queue/route";
import * as leadDashRoute from "@/app/api/dashboard/lead/route";
import * as managerDashRoute from "@/app/api/dashboard/manager/route";
import * as exportRoute from "@/app/api/export/tasks/route";
import * as searchRoute from "@/app/api/search/route";
import * as usersRoute from "@/app/api/users/route";
import * as userRoute from "@/app/api/users/[id]/route";
import * as approveUserRoute from "@/app/api/users/[id]/approve/route";
import * as rejectUserRoute from "@/app/api/users/[id]/reject/route";
import { prisma } from "@/lib/db/prisma";
import { call, FIXTURE_WEEK, makeCompany, reportTotals, request, resetDatabase, signInAs, type DepartmentFixture } from "./helpers";

type Company = Awaited<ReturnType<typeof makeCompany>>;

/**
 * Every API route is listed once here. The guard test below fails if a route file is added without
 * an entry, so a new route can't ship without saying how it isolates departments.
 * Later phases add their routes to this table.
 */
const ROUTE_POLICIES: Record<string, string> = {
  "auth/[...nextauth]": "Auth.js protocol endpoints. They expose no department data.",
  "auth/sso/entra/login": "Public. Redirects to Microsoft sign-in. It reads and returns no data.",
  "auth/sso/entra/callback":
    "Public. Completes Microsoft sign-in for an existing, active account only. It returns no data.",
  me: "Returns the caller only.",
  "me/preferences": "Changes the caller only.",
  "me/tokens": "Lists and creates the caller's own API tokens only. Tested in daily-sync.test.ts.",
  "me/tokens/[id]": "Revokes the caller's own tokens only; others are 404. Tested in daily-sync.test.ts.",
  "integrations/daily-sync":
    "API token only. Writes the token owner's tasks on projects in their own scope. Tested in daily-sync.test.ts.",
  "me/department-filter": "CEO only. Tested below.",
  users: "Tested below.",
  "users/[id]": "Tested below.",
  "users/[id]/approve": "Super Admin and CEO only. Tested below and in user-access.test.ts.",
  "users/[id]/reject": "Super Admin and CEO only. Tested below and in user-access.test.ts.",
  "site-settings/approval": "Super Admin only. Organisation-wide, with no department data. Tested in site-settings.test.ts.",
  "site-settings/env": "Super Admin only. Never returns a secret's value. Tested in site-settings.test.ts.",
  departments: "Tested below.",
  "departments/[id]": "Tested below.",
  "departments/[id]/archive": "Tested below.",
  "departments/[id]/restore": "Tested below.",
  "departments/[id]/manager": "Tested below.",
  projects: "Tested below and in projects.test.ts.",
  "projects/[id]": "Tested below and in projects.test.ts.",
  "projects/[id]/members": "Tested below and in projects.test.ts.",
  "projects/[id]/audit": "Whoever manages the project; another department's is a 404. Tested in dependency-audit.test.ts.",
  "projects/import":
    "A department's manager only, importing into their own department with its own Bitbucket connection. Tested in bitbucket-import.test.ts.",
  "bitbucket/connection":
    "A department's manager only, for their own department. The token is never returned. Tested in bitbucket-import.test.ts.",
  tasks: "Own tasks only. Tested in tasks-and-reports.test.ts.",
  "tasks/[id]": "Own tasks only: others' are a 404. Tested in tasks-and-reports.test.ts.",
  "tasks/copy": "Copies the caller's own tasks only.",
  "task-templates": "Own templates only. Tested in tasks-and-reports.test.ts.",
  "task-templates/[id]": "Own templates only. Tested in tasks-and-reports.test.ts.",
  "reports/mine": "Own reports only.",
  "reports/review-queue": "Reports waiting for the caller. Tested below.",
  "reports/[id]": "Approval gate. Tested below and in tasks-and-reports.test.ts.",
  "reports/[id]/submit": "Owner only. Tested in tasks-and-reports.test.ts.",
  "reports/[id]/approve": "Current approver only. Tested below.",
  "reports/[id]/request-changes": "Current approver only. Tested below.",
  "reports/[id]/export": "Owner only. Tested in dashboards-export-ai.test.ts.",
  notifications: "Own notifications only. Tested in notifications-and-reminders.test.ts.",
  "notifications/read": "Own notifications only. Tested in notifications-and-reminders.test.ts.",
  "notifications/stream": "Own notifications only.",
  "dashboard/developer": "Own work only. Tested in dashboards-export-ai.test.ts.",
  "dashboard/lead": "Tested below and in dashboards-export-ai.test.ts.",
  "dashboard/manager": "Tested below and in dashboards-export-ai.test.ts.",
  "dashboard/ceo": "CEO only, approved work only. Tested in dashboards-export-ai.test.ts.",
  "dashboard/activity": "Tested in dashboards-export-ai.test.ts.",
  "dashboard/audit": "Projects in the caller's project scope only. Tested in dependency-audit.test.ts.",
  "export/tasks": "Tested below and in dashboards-export-ai.test.ts.",
  "ai/improve": "No department data. Tested in dashboards-export-ai.test.ts.",
  team: "Tested in dashboards-export-ai.test.ts.",
  search: "Tested below and in dashboards-export-ai.test.ts.",
  "cron/reminders": "Secret-protected job, no response data. Tested in notifications-and-reminders.test.ts.",
  "cron/audit": "Secret-protected job that returns counts only. Tested in dependency-audit.test.ts.",
};

function listApiRoutes(directory: string, root = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return listApiRoutes(full, root);
    return entry.name === "route.ts" ? [relative(root, directory).split(sep).join("/")] : [];
  });
}

describe("route coverage", () => {
  it("has an isolation policy for every API route", () => {
    expect(listApiRoutes(join(process.cwd(), "src/app/api")).sort()).toEqual(
      Object.keys(ROUTE_POLICIES).sort(),
    );
  });
});

const NON_CEO_ROLES = [
  ["manager", "MANAGER"],
  ["lead", "TEAM_LEAD"],
  ["developer", "DEVELOPER"],
] as const satisfies readonly (readonly [keyof DepartmentFixture, Role])[];

describe("department isolation", () => {
  let company: Company;

  beforeAll(resetDatabase);
  beforeEach(async () => {
    await resetDatabase();
    company = await makeCompany();
  });

  // Run in both directions so that isolation can't pass by accident of one department's data.
  describe.each([
    ["IT", "HR", "it", "hr"],
    ["HR", "IT", "hr", "it"],
  ] as const)("%s staff looking at %s", (_own, _other, ownKey, otherKey) => {
    describe.each(NON_CEO_ROLES)("as %s", (actorKey) => {
      const actor = () => company[ownKey][actorKey] as { id: string };
      const otherDepartment = () => company[otherKey].department.id;
      const otherUser = () => company[otherKey].developer.id;

      beforeEach(() => signInAs(actor()));

      it("GET /departments returns only their own department", async () => {
        const { status, body } = await call(departmentsRoute.GET, request("GET", "/api/departments"));
        expect(status).toBe(200);
        expect(body.data.map((row: { id: string }) => row.id)).toEqual([
          company[ownKey].department.id,
        ]);
      });

      it.each([
        ["GET", () => departmentRoute.GET, undefined],
        ["PATCH", () => departmentRoute.PATCH, { description: "hacked" }],
        ["DELETE", () => departmentRoute.DELETE, undefined],
        ["POST archive", () => archiveRoute.POST, undefined],
        ["POST restore", () => restoreRoute.POST, undefined],
        ["POST manager", () => managerRoute.POST, { mode: "new", name: "Evil", email: "e@e.io" }],
      ] as const)("%s on the other department is a 404", async (label, handler, body) => {
        const method = label.split(" ")[0]!;
        const { status } = await call(
          handler(),
          request(method, `/api/departments/${otherDepartment()}`, { body }),
          { id: otherDepartment() },
        );
        expect(status).toBe(404);
      });

      it.each([
        ["GET", () => userRoute.GET, undefined],
        ["PATCH", () => userRoute.PATCH, { name: "Hacked" }],
      ] as const)("%s /users/:id for the other department is a 404", async (method, handler, body) => {
        const { status } = await call(
          handler(),
          request(method, `/api/users/${otherUser()}`, { body }),
          { id: otherUser() },
        );
        expect(status).toBe(404);
      });

      it("POST /users/:id/approve and /reject for the other department are a 404", async () => {
        const approve = await call(
          approveUserRoute.POST,
          request("POST", `/api/users/${otherUser()}/approve`, { body: { role: "DEVELOPER" } }),
          { id: otherUser() },
        );
        expect(approve.status).toBe(404);
        const reject = await call(
          rejectUserRoute.POST,
          request("POST", `/api/users/${otherUser()}/reject`),
          { id: otherUser() },
        );
        expect(reject.status).toBe(404);
      });

      it.each([
        ["GET", () => projectRoute.GET, undefined],
        ["PATCH", () => projectRoute.PATCH, { name: "Hacked" }],
        ["DELETE", () => projectRoute.DELETE, undefined],
        ["POST members", () => membersRoute.POST, { add: [] as string[], remove: ["x"] }],
      ] as const)("%s on the other department's project is a 404", async (label, handler, body) => {
        const id = company[otherKey].project.id;
        const payload =
          body && "remove" in body ? { remove: [company[otherKey].developer.id] } : body;
        const { status } = await call(
          handler(),
          request(label.split(" ")[0]!, `/api/projects/${id}`, { body: payload }),
          { id },
        );
        expect(status).toBe(404);
      });

      it("GET /projects never lists the other department's projects", async () => {
        for (const query of [
          "",
          `?departmentId=${otherDepartment()}`,
          `?search=${encodeURIComponent(company[otherKey].project.name)}`,
        ]) {
          const { body } = await call(projectsRoute.GET, request("GET", `/api/projects${query}`));
          const ids = body.data.map((row: { id: string }) => row.id);
          expect(ids).not.toContain(company[otherKey].project.id);
        }
        const withCookie = await call(
          projectsRoute.GET,
          request("GET", "/api/projects", {
            cookie: `${DEPARTMENT_FILTER_COOKIE}=${otherDepartment()}`,
          }),
        );
        expect(withCookie.body.data.map((row: { id: string }) => row.id)).not.toContain(
          company[otherKey].project.id,
        );
      });

      it.each([
        ["GET", () => reportRoute.GET],
        ["POST approve", () => approveRoute.POST],
        ["POST request-changes", () => changesRoute.POST],
        ["POST submit", () => submitRoute.POST],
      ] as const)("%s on the other department's report is a 404", async (label, handler) => {
        const id = company[otherKey].report.id;
        const { status } = await call(
          handler(),
          request(label.split(" ")[0]!, `/api/reports/${id}`, {
            body: label === "GET" ? undefined : { comment: "Nope." },
          }),
          { id },
        );
        expect(status).toBe(404);
      });

      it("never sees the other department in dashboards, exports or search", async () => {
        const other = company[otherKey];
        const range = `?from=${new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`;
        const routes = actorKey === "manager" ? [managerDashRoute.GET] : actorKey === "lead" ? [leadDashRoute.GET] : [];
        for (const route of routes) {
          const { body } = await call(route, request("GET", `/x${range}&departmentId=${otherDepartment()}`));
          expect(JSON.stringify(body)).not.toContain(other.project.name);
        }
        const search = await call(searchRoute.GET, request("GET", `/api/search?q=${encodeURIComponent(other.project.name)}`));
        expect(search.body.data.projects).toEqual([]);
        if (actorKey !== "developer") {
          const exported = await exportRoute.GET(
            request("GET", `/api/export/tasks${range}&departmentId=${otherDepartment()}`, {
              cookie: `${DEPARTMENT_FILTER_COOKIE}=${otherDepartment()}`,
            }),
            { params: Promise.resolve({}) },
          );
          expect(exported.status).toBe(200);
          // An .xlsx is compressed, so the rows have to be read back to be checked.
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()) as unknown as ArrayBuffer);
          const details: string[] = [];
          workbook.getWorksheet("Tasks")!.eachRow((row) => details.push(String(row.getCell(6).value)));
          expect(details).toContain(`${company[ownKey].department.name} secret task`);
          expect(details).not.toContain(`${other.department.name} secret task`);
        }
      });

      it("never sees the other department's reports in their review queue", async () => {
        await prisma.weeklyReport.updateMany({ where: { id: company[otherKey].report.id }, data: { status: "SUBMITTED", currentApproverId: actor().id } });
        const { body } = await call(queueRoute.GET, request("GET", "/api/reports/review-queue"));
        expect(body.data).toEqual([]);
      });

      it("the switcher route does not exist for them", async () => {
        const { status } = await call(
          filterRoute.PUT,
          request("PUT", "/api/me/department-filter", { body: { departmentId: otherDepartment() } }),
        );
        expect(status).toBe(404);
      });

      it("makes no change to the other department", async () => {
        await call(
          departmentRoute.PATCH,
          request("PATCH", `/api/departments/${otherDepartment()}`, {
            body: { description: "hacked" },
          }),
          { id: otherDepartment() },
        );
        const unchanged = await prisma.department.findUnique({ where: { id: otherDepartment() } });
        expect(unchanged?.description).not.toBe("hacked");
      });

      it("/me returns only themselves", async () => {
        const { body } = await call(meRoute.GET, request("GET", "/api/me"));
        expect(body.data.id).toBe(String(actor().id));
      });
    });

    describe.each([
      ["manager", "manager"],
      ["lead", "lead"],
    ] as const)("listing people as %s", (_label, actorKey) => {
      beforeEach(() => signInAs(company[ownKey][actorKey]));

      async function listedIds(query = "") {
        const { body } = await call(usersRoute.GET, request("GET", `/api/users${query}`));
        return body.data.map((row: { id: string }) => row.id) as string[];
      }

      it("sees only their department, with the CEO left out", async () => {
        const ids = await listedIds();
        expect(ids).toHaveLength(4);
        expect(ids).toContain(company[ownKey].developer.id);
        expect(ids).not.toContain(company[otherKey].developer.id);
        expect(ids).not.toContain(company.ceo.id);
      });

      it("can't reach the other department with a departmentId query", async () => {
        const ids = await listedIds(`?departmentId=${company[otherKey].department.id}`);
        expect(ids).not.toContain(company[otherKey].developer.id);
        expect(ids).toContain(company[ownKey].developer.id);
      });

      it("can't reach the other department with the CEO's switcher cookie", async () => {
        const { body } = await call(
          usersRoute.GET,
          request("GET", "/api/users", {
            cookie: `${DEPARTMENT_FILTER_COOKIE}=${company[otherKey].department.id}`,
          }),
        );
        const ids = body.data.map((row: { id: string }) => row.id);
        expect(ids).not.toContain(company[otherKey].developer.id);
        expect(ids).toContain(company[ownKey].developer.id);
      });

      it("can't reach the other department by searching for its people", async () => {
        const other = company[otherKey].developer;
        expect(await listedIds(`?search=${encodeURIComponent(other.email)}`)).toEqual([]);
      });

      it("can't use the unassigned flag to see outside their department", async () => {
        const unassigned = await prisma.user.create({ data: {
          name: "Free Manager",
          email: "free@test.local",
          role: "MANAGER",
          departmentId: null,
          reportsTo: company.ceo.id,
        } });
        expect(await listedIds("?unassigned=true")).not.toContain(unassigned.id);
      });
    });
  });

  describe("role limits inside a department", () => {
    it("forbids a developer from listing people, while they can still read themselves", async () => {
      signInAs(company.it.developer);
      const list = await call(usersRoute.GET, request("GET", "/api/users"));
      expect(list.status).toBe(403);
      const self = await call(
        userRoute.GET,
        request("GET", `/api/users/${company.it.developer.id}`),
        { id: company.it.developer.id },
      );
      expect(self.status).toBe(200);
    });

    it("hides a colleague's record from a developer", async () => {
      signInAs(company.it.developer);
      const id = company.it.lead.id;
      const { status } = await call(userRoute.GET, request("GET", `/api/users/${id}`), { id });
      expect(status).toBe(404);
    });

    it.each(["manager", "lead", "developer"] as const)(
      "stops a %s from changing their own department's record",
      async (actorKey) => {
        signInAs(company.it[actorKey]);
        const id = company.it.department.id;
        const { status } = await call(
          departmentRoute.PATCH,
          request("PATCH", `/api/departments/${id}`, { body: { description: "x" } }),
          { id },
        );
        expect(status).toBe(403);
      },
    );

    it.each(["manager", "lead", "developer"] as const)(
      "stops a %s from creating departments and users",
      async (actorKey) => {
        signInAs(company.it[actorKey]);
        const department = await call(
          departmentsRoute.POST,
          request("POST", "/api/departments", {
            body: {
              name: "Rogue",
              code: "ROGUE",
              color: "teal",
              manager: { mode: "new", name: "Rogue Boss", email: "rogue@test.local" },
            },
          }),
        );
        expect(department.status).toBe(403);
        const user = await call(
          usersRoute.POST,
          request("POST", "/api/users", {
            body: {
              name: "Rogue Dev",
              email: "dev@test.local",
              role: "DEVELOPER",
              departmentId: company.hr.department.id,
              reportsTo: company.hr.lead.id,
            },
          }),
        );
        expect(user.status).toBe(403);
      },
    );

    it("stops a user promoting themselves through their own record", async () => {
      signInAs(company.it.developer);
      const id = company.it.developer.id;
      const { status } = await call(
        userRoute.PATCH,
        request("PATCH", `/api/users/${id}`, { body: { role: "MANAGER" } }),
        { id },
      );
      expect(status).toBe(403);
      expect((await prisma.user.findUnique({ where: { id: id } }))?.role).toBe("DEVELOPER");
    });

    it("gives an unassigned manager no department and no people", async () => {
      const free = await prisma.user.create({ data: {
        name: "Free Manager",
        email: "free@test.local",
        role: "MANAGER",
        departmentId: null,
        reportsTo: company.ceo.id,
      } });
      signInAs(free);
      const departments = await call(departmentsRoute.GET, request("GET", "/api/departments"));
      expect(departments.body.data).toEqual([]);
      const people = await call(usersRoute.GET, request("GET", "/api/users"));
      expect(people.body.data).toEqual([]);
    });
  });

  describe("the CEO", () => {
    beforeEach(() => signInAs(company.ceo));

    it("sees every department", async () => {
      const { body } = await call(departmentsRoute.GET, request("GET", "/api/departments"));
      expect(body.data).toHaveLength(2);
    });

    it("sees people from all departments, then one after using the switcher", async () => {
      const all = await call(usersRoute.GET, request("GET", "/api/users"));
      expect(all.body.meta.total).toBe(9);

      const switched = await call(
        filterRoute.PUT,
        request("PUT", "/api/me/department-filter", {
          body: { departmentId: company.hr.department.id },
        }),
      );
      expect(switched.status).toBe(200);
      const cookie = switched.response.headers.get("set-cookie")!.split(";")[0]!;
      expect(switched.response.headers.get("set-cookie")).toMatch(/HttpOnly/i);

      const hrOnly = await call(usersRoute.GET, request("GET", "/api/users", { cookie }));
      const ids = hrOnly.body.data.map((row: { id: string }) => row.id);
      expect(ids).toHaveLength(4);
      expect(ids).toContain(company.hr.developer.id);
      expect(ids).not.toContain(company.it.developer.id);
    });

    it("gets a 404 when switching to a department that doesn't exist", async () => {
      const { status } = await call(
        filterRoute.PUT,
        request("PUT", "/api/me/department-filter", {
          body: { departmentId: randomUUID() },
        }),
      );
      expect(status).toBe(404);
    });

    it("only sees approved work in a department's mini dashboard", async () => {
      const id = company.it.department.id;
      await prisma.weeklyReport.create({ data: {
        userId: company.it.otherDeveloper.id,
        departmentId: company.it.department.id,
        ...FIXTURE_WEEK,
        status: "LEAD_APPROVED",
        ...reportTotals(company.it.project.id, 99),
      } });
      const { body } = await call(
        departmentRoute.GET,
        request("GET", `/api/departments/${id}`),
        { id },
      );
      expect(body.data.approved.totalHours).toBe(8);
      expect(body.data.approved.byProject).toEqual([
        { name: "IT project", color: "teal", hours: 8 },
      ]);
    });
  });

  describe("request safety", () => {
    it("rejects unauthenticated requests with the standard error shape", async () => {
      signInAs(null);
      const { status, body } = await call(usersRoute.GET, request("GET", "/api/users"));
      expect(status).toBe(401);
      expect(body).toEqual({ error: { code: "UNAUTHORIZED", message: expect.any(String) } });
    });

    it("rejects a write from another origin", async () => {
      signInAs(company.ceo);
      const id = company.it.department.id;
      const { status } = await call(
        departmentRoute.PATCH,
        request("PATCH", `/api/departments/${id}`, {
          body: { description: "x" },
          origin: "https://evil.example",
        }),
        { id },
      );
      expect(status).toBe(403);
    });

    it("treats a malformed id as not found", async () => {
      signInAs(company.ceo);
      const { status } = await call(
        departmentRoute.GET,
        request("GET", "/api/departments/not-an-id"),
        { id: "not-an-id" },
      );
      expect(status).toBe(404);
    });

    it("returns only the listed user fields", async () => {
      signInAs(company.ceo);
      const list = await call(usersRoute.GET, request("GET", "/api/users?limit=100"));
      expect(Object.keys(list.body.data[0]).sort()).toEqual(
        ["approval", "avatarColor", "department", "email", "id", "isActive", "name", "reportsTo", "role"].sort(),
      );
    });
  });
});
