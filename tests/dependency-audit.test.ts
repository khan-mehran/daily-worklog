import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as cronRoute from "@/app/api/cron/audit/route";
import * as overviewRoute from "@/app/api/dashboard/audit/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectRoute from "@/app/api/projects/[id]/route";
import * as checkRoute from "@/app/api/projects/[id]/audit/route";
import { installedPackages } from "@/lib/audit/lockfile";
import { auditProject, auditReport, runDueAudits } from "@/lib/audit/service";
import { DEPARTMENT_FILTER_COOKIE } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { sendEmailSafely } from "@/lib/email";
import { normaliseRepository } from "@/validators/project";
import { call, makeCompany, request, resetDatabase, signInAs } from "./helpers";

type Company = Awaited<ReturnType<typeof makeCompany>>;
let company: Company;

const LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    "": { name: "app", version: "1.0.0" },
    "node_modules/lodash": { version: "4.17.15" },
    "node_modules/left-pad": { version: "1.3.0" },
    "node_modules/a/node_modules/lodash": { version: "4.17.21" },
  },
});

const ADVISORIES = {
  lodash: [
    { url: "https://example.test/1", title: "Command Injection in lodash", severity: "high", vulnerable_versions: "<4.17.21" },
    { url: "https://example.test/2", title: "ReDoS in lodash", severity: "moderate", vulnerable_versions: ">=4.0.0 <4.17.21" },
  ],
};

interface Network {
  /** The lockfile's text, or null for a repository without one. */
  lock?: string | null;
  advisories?: object;
  repositoryExists?: boolean;
  bitbucketDown?: boolean;
}

/** Stands in for Bitbucket and the npm registry. Returns the requests made, as "METHOD url". */
function network({ lock = LOCK, advisories = ADVISORIES, repositoryExists = true, bitbucketDown = false }: Network = {}) {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url.startsWith("https://api.bitbucket.org/")) {
        if (bitbucketDown) throw new TypeError("fetch failed");
        if (url.endsWith("/package-lock.json")) return lock === null ? new Response("", { status: 404 }) : new Response(lock);
        if (url.endsWith("/npm-shrinkwrap.json")) return new Response("", { status: 404 });
        return repositoryExists ? Response.json({}) : new Response("", { status: 404 });
      }
      if (url.startsWith("https://registry.npmjs.org/")) return Response.json(advisories);
      throw new Error(`Unexpected request to ${url}`);
    }),
  );
  return requests;
}

const link = (projectId: string, repository = "acme/portal") =>
  prisma.project.update({ where: { id: projectId }, data: { repository } });
const auditOf = (projectId: string) => prisma.projectAudit.findUnique({ where: { projectId } });
const alerts = () => prisma.notification.findMany({ where: { type: "SECURITY_ALERT" } });

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(sendEmailSafely).mockClear();
  process.env.BITBUCKET_TOKEN = "test-token";
  delete process.env.BITBUCKET_USERNAME;
  company = await makeCompany();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading a lockfile", () => {
  it("collects every installed version, and skips the project, workspaces and links", () => {
    const installed = installedPackages(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { name: "app", version: "1.0.0" },
          "packages/ui": { name: "ui", version: "0.1.0" },
          "node_modules/ui": { resolved: "packages/ui", link: true },
          "node_modules/lodash": { version: "4.17.15" },
          "node_modules/a/node_modules/lodash": { version: "4.17.21" },
          "node_modules/@scope/pkg": { version: "2.0.0" },
          "node_modules/alias": { name: "real-name", version: "3.0.0" },
          "node_modules/from-git": { version: "git+ssh://git@example.test/x.git#abc" },
        },
      }),
    );
    expect(Object.fromEntries([...installed].map(([name, versions]) => [name, [...versions]]))).toEqual({
      lodash: ["4.17.15", "4.17.21"],
      "@scope/pkg": ["2.0.0"],
      "real-name": ["3.0.0"],
    });
  });

  it("reads the old nested format", () => {
    const installed = installedPackages(
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          a: { version: "1.0.0", dependencies: { b: { version: "2.0.0" } } },
          alias: { version: "npm:@scope/real@3.0.0" },
        },
      }),
    );
    expect([...installed.keys()].sort()).toEqual(["@scope/real", "a", "b"]);
  });

  it("refuses text that isn't a lockfile", () => {
    expect(() => installedPackages("<html>")).toThrow("isn't valid JSON");
    expect(() => installedPackages("{}")).toThrow("lists no packages");
  });
});

describe("the repository field", () => {
  it("accepts workspace/repo, a folder inside it, and pasted Bitbucket addresses", () => {
    expect(normaliseRepository("acme/portal")).toBe("acme/portal");
    expect(normaliseRepository("acme/portal/apps/web/")).toBe("acme/portal/apps/web");
    expect(normaliseRepository("https://bitbucket.org/acme/portal.git")).toBe("acme/portal");
    expect(normaliseRepository("https://someone@bitbucket.org/acme/portal/src/main/")).toBe("acme/portal");
    expect(normaliseRepository("git@bitbucket.org:acme/portal.git")).toBe("acme/portal");
  });

  it("rejects anything else", () => {
    for (const bad of ["portal", "acme/portal/../other", "acme/por tal", "https://github.com/acme/portal", "acme/portal?x=1"]) {
      expect(normaliseRepository(bad), bad).toBeNull();
    }
  });

  it("is saved from the project form, and a new repository is checked straight away", async () => {
    network();
    const project = await link(company.it.project.id);
    await auditProject(project);
    expect(await auditOf(project.id)).not.toBeNull();

    signInAs(company.it.manager);
    const patch = (repository: unknown) =>
      call(projectRoute.PATCH, request("PATCH", "/x", { body: { repository } }), { id: project.id });
    expect((await patch("not a repository")).status).toBe(400);
    expect((await patch("https://bitbucket.org/acme/other.git")).status).toBe(200);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).repository).toBe("acme/other");
    expect(await auditOf(project.id)).toMatchObject({ status: "VULNERABLE", error: null });

    // A repository the token can't read still saves, and says why beside the project.
    network({ lock: null, repositoryExists: false });
    expect((await patch("other-workspace/private")).status).toBe(200);
    expect((await auditOf(project.id))?.error).toContain("other-workspace/private wasn't found");

    expect((await patch("")).status).toBe(200);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).repository).toBeNull();
    expect(await auditOf(project.id)).toBeNull();
  });

  it("checks a new project that is created with a repository", async () => {
    network();
    signInAs(company.it.manager);
    const { status, body } = await call(
      projectsRoute.POST,
      request("POST", "/api/projects", {
        body: { name: "Portal", code: "PORTAL", color: "sky", repository: "https://bitbucket.org/acme/portal/src/main/" },
      }),
    );
    expect(status).toBe(201);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: body.data.id } })).repository).toBe("acme/portal");
    expect(await auditOf(body.data.id)).toMatchObject({ status: "VULNERABLE", high: 1 });
  });
});

describe("auditing a project", () => {
  it("counts each vulnerable package once, by its worst advisory, for the versions installed", async () => {
    const requests = network();
    const project = await link(company.it.project.id, "acme/portal/web");
    await auditProject(project);

    expect(requests[0]).toBe("GET https://api.bitbucket.org/2.0/repositories/acme/portal/src/HEAD/web/package-lock.json");
    const audit = await auditOf(project.id);
    expect(audit).toMatchObject({ status: "VULNERABLE", critical: 0, high: 1, moderate: 0, low: 0, error: null });
    expect(audit?.checkedAt).not.toBeNull();
    expect(audit?.findings).toEqual([
      {
        name: "lodash",
        // 4.17.21 is installed too, and isn't affected.
        versions: ["4.17.15"],
        severity: "high",
        title: "Command Injection in lodash",
        url: "https://example.test/1",
        advisories: 2,
      },
    ]);
  });

  it("is clear when no advisory matches an installed version", async () => {
    network({ lock: JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/lodash": { version: "4.17.21" } } }) });
    const project = await link(company.it.project.id);
    await auditProject(project);
    expect(await auditOf(project.id)).toMatchObject({ status: "CLEAR", high: 0, findings: [] });
    expect(await alerts()).toEqual([]);
  });

  it("sends the token as Bearer, or with a username as Basic", async () => {
    network();
    const project = await link(company.it.project.id);
    await auditProject(project);
    const headersOf = (index: number) => vi.mocked(fetch).mock.calls[index]![1]!.headers as Record<string, string>;
    expect(headersOf(0).Authorization).toBe("Bearer test-token");

    vi.mocked(fetch).mockClear();
    process.env.BITBUCKET_USERNAME = "someone@example.test";
    await auditProject(project);
    expect(headersOf(0).Authorization).toBe(`Basic ${Buffer.from("someone@example.test:test-token").toString("base64")}`);
    // The token never goes to the npm registry.
    const registryCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).startsWith("https://registry.npmjs.org/"))!;
    expect(JSON.stringify(registryCall[1])).not.toContain("test-token");
  });

  it("tells a repository without a lockfile from one that can't be read", async () => {
    const project = await link(company.it.project.id);
    network({ lock: null });
    await auditProject(project);
    expect(await auditOf(project.id)).toMatchObject({ status: "NO_LOCKFILE", error: null });

    await prisma.projectAudit.deleteMany();
    network({ lock: null, repositoryExists: false });
    await auditProject(project);
    const audit = await auditOf(project.id);
    expect(audit).toMatchObject({ status: "UNKNOWN", checkedAt: null });
    expect(audit?.error).toContain("acme/portal wasn't found");
  });

  it("keeps the last result when a later check fails", async () => {
    const project = await link(company.it.project.id);
    network();
    await auditProject(project, new Date("2026-11-20T03:00:00Z"));
    network({ bitbucketDown: true });
    await auditProject(project, new Date("2026-11-21T03:00:00Z"));
    const audit = await auditOf(project.id);
    expect(audit).toMatchObject({ status: "VULNERABLE", high: 1, error: "Bitbucket couldn't be reached." });
    expect(audit?.checkedAt?.toISOString()).toBe("2026-11-20T03:00:00.000Z");
    expect(audit?.attemptedAt.toISOString()).toBe("2026-11-21T03:00:00.000Z");
  });

  it("alerts the owner and the manager when a project becomes vulnerable or gets worse, not every day", async () => {
    // The fixture's manager owns the project, so make the lead its owner to have two recipients.
    await prisma.project.update({ where: { id: company.it.project.id }, data: { ownerId: company.it.lead.id } });
    const project = await link(company.it.project.id);
    network();
    await auditProject(project);
    const first = await alerts();
    expect(first.map((alert) => alert.recipientId).sort()).toEqual([company.it.lead.id, company.it.manager.id].sort());
    expect(first[0]).toMatchObject({ link: `/projects/${project.id}`, departmentId: company.it.department.id });
    expect(first[0]!.message).toContain("1 vulnerable package in IT project (1 high)");
    expect(sendEmailSafely).toHaveBeenCalledTimes(2);

    await auditProject(project);
    expect(await alerts()).toHaveLength(2);

    network({ advisories: { ...ADVISORIES, "left-pad": [{ title: "Bad", severity: "critical", vulnerable_versions: "*" }] } });
    await auditProject(project);
    expect(await alerts()).toHaveLength(4);
    expect(await auditOf(project.id)).toMatchObject({ critical: 1, high: 1 });
  });
});

describe("the daily run", () => {
  it("does nothing until Bitbucket is connected", async () => {
    const requests = network();
    await link(company.it.project.id);
    delete process.env.BITBUCKET_TOKEN;
    expect(await runDueAudits()).toEqual({ configured: false, checked: 0, vulnerable: 0, failed: 0 });
    expect(requests).toEqual([]);
  });

  it("checks every linked project once a day, however often it is called", async () => {
    network();
    await link(company.it.project.id);
    await link(company.hr.project.id, "acme/hr");
    const at = (hours: number) => new Date(Date.UTC(2026, 10, 20, 3) + hours * 60 * 60 * 1000);

    expect(await runDueAudits(at(0))).toEqual({ configured: true, checked: 2, vulnerable: 2, failed: 0 });
    expect(await runDueAudits(at(1))).toMatchObject({ checked: 0 });
    expect(await runDueAudits(at(19))).toMatchObject({ checked: 0 });
    expect(await runDueAudits(at(24))).toMatchObject({ checked: 2 });
    expect(await runDueAudits(at(25), { force: true })).toMatchObject({ checked: 2 });
  });

  it("leaves projects without a repository alone, and tries a failed check again within the hour", async () => {
    await link(company.it.project.id);
    const start = new Date("2026-11-20T03:00:00Z");
    network({ bitbucketDown: true });
    expect(await runDueAudits(start)).toEqual({ configured: true, checked: 1, vulnerable: 0, failed: 1 });
    expect(await auditOf(company.hr.project.id)).toBeNull();

    network();
    expect(await runDueAudits(new Date(start.getTime() + 10 * 60 * 1000))).toMatchObject({ checked: 0 });
    expect(await runDueAudits(new Date(start.getTime() + 60 * 60 * 1000))).toMatchObject({ checked: 1, vulnerable: 1, failed: 0 });
  });

  it("the cron endpoint needs the secret", async () => {
    network();
    process.env.CRON_SECRET = "test-secret-value";
    expect((await call(cronRoute.GET, request("GET", "/api/cron/audit"))).status).toBe(401);
    const right = request("GET", "/api/cron/audit");
    right.headers.set("authorization", "Bearer test-secret-value");
    const ok = await call(cronRoute.GET, right);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ configured: true, checked: 0, vulnerable: 0, failed: 0 });
  });
});

describe("who sees the results", () => {
  const overview = (cookie?: string) => call(overviewRoute.GET, request("GET", "/api/dashboard/audit", { cookie }));
  const names = async (cookie?: string) =>
    (await overview(cookie)).body.data.projects.map((row: { name: string }) => row.name) as string[];

  beforeEach(async () => {
    network();
    await link(company.it.project.id);
    await link(company.hr.project.id, "acme/hr");
    await runDueAudits();
  });

  it("keeps each department to its own projects, and a developer to their assigned ones", async () => {
    signInAs(company.it.manager);
    expect(await names()).toEqual(["IT project"]);
    signInAs(company.hr.lead);
    expect(await names()).toEqual(["HR project"]);
    signInAs(company.it.developer);
    expect(await names()).toEqual(["IT project"]);
    signInAs(company.it.otherDeveloper);
    expect(await names()).toEqual([]);
    signInAs(null);
    expect((await overview()).status).toBe(401);
  });

  it("gives the CEO every department, or the one the switcher has selected", async () => {
    signInAs(company.ceo);
    expect(await names()).toEqual(["HR project", "IT project"]);
    expect(await names(`${DEPARTMENT_FILTER_COOKIE}=${company.hr.department.id}`)).toEqual(["HR project"]);
  });

  it("lists the worst first, and counts the projects nobody has linked", async () => {
    await prisma.project.create({
      data: { departmentId: company.it.department.id, name: "Unlinked", code: "UNL", color: "teal", ownerId: company.it.manager.id, createdBy: company.it.manager.id },
    });
    const clear = await prisma.project.create({
      data: { departmentId: company.it.department.id, name: "A clear one", code: "CLR", color: "teal", repository: "acme/clear", ownerId: company.it.manager.id, createdBy: company.it.manager.id },
    });
    network({ advisories: {} });
    await auditProject(clear);

    signInAs(company.it.manager);
    const { body } = await overview();
    expect(body.data.unlinked).toBe(1);
    expect(body.data.projects.map((row: { name: string; status: string }) => [row.name, row.status])).toEqual([
      ["IT project", "VULNERABLE"],
      ["A clear one", "CLEAR"],
    ]);
    expect(body.data.projects[0].counts).toEqual({ critical: 0, high: 1, moderate: 0, low: 0 });
    // The package list stays on the project's own page.
    expect(body.data.projects[0]).not.toHaveProperty("findings");
  });

  it("shows the vulnerable packages on the project's page", async () => {
    signInAs(company.it.developer);
    const { body } = await call(projectRoute.GET, request("GET", "/x"), { id: company.it.project.id });
    expect(body.data.repository).toBe("acme/portal");
    expect(body.data.audit.status).toBe("VULNERABLE");
    expect(body.data.audit.findings[0].name).toBe("lodash");
    expect((await call(projectRoute.GET, request("GET", "/x"), { id: company.hr.project.id })).status).toBe(404);
  });
});

describe("the Dependency audit page", () => {
  beforeEach(async () => {
    network();
    await link(company.it.project.id);
    await runDueAudits();
    await prisma.project.create({
      data: { departmentId: company.it.department.id, name: "Unlinked", code: "UNL", color: "teal", ownerId: company.it.manager.id, createdBy: company.it.manager.id },
    });
  });

  it("lists every project in scope with its packages, linked ones first", async () => {
    const report = await auditReport(company.it.manager, null);
    expect(report.projects.map((row) => [row.name, row.repository, row.status, row.findings.length])).toEqual([
      ["IT project", "acme/portal", "VULNERABLE", 1],
      ["Unlinked", null, "UNKNOWN", 0],
    ]);
    expect(report.projects[0]!.department.name).toBe("IT");
  });

  it("follows the same visibility as the projects list", async () => {
    const namesFor = async (actor: Parameters<typeof auditReport>[0], selected: string | null = null) =>
      (await auditReport(actor, selected)).projects.map((row) => row.name);
    expect(await namesFor(company.hr.manager)).toEqual(["HR project"]);
    expect(await namesFor(company.it.developer)).toEqual(["IT project"]);
    expect(await namesFor(company.it.otherDeveloper)).toEqual([]);
    expect(await namesFor(company.ceo)).toEqual(["IT project", "HR project", "Unlinked"]);
    expect(await namesFor(company.ceo, company.hr.department.id)).toEqual(["HR project"]);
    // The switcher is ignored for everyone below the CEO.
    expect(await namesFor(company.it.manager, company.hr.department.id)).toEqual(["IT project", "Unlinked"]);
  });
});

describe("checking a project now", () => {
  const check = (id: string) => call(checkRoute.POST, request("POST", "/x"), { id });

  it("is for whoever manages the project", async () => {
    network();
    await link(company.it.project.id);
    await link(company.hr.project.id, "acme/hr");

    signInAs(company.it.developer);
    expect((await check(company.it.project.id)).status).toBe(403);
    signInAs(company.ceo);
    expect((await check(company.it.project.id)).status).toBe(403);
    signInAs(company.it.manager);
    expect((await check(company.hr.project.id)).status).toBe(404);
    expect(await auditOf(company.it.project.id)).toBeNull();

    const { status, body } = await check(company.it.project.id);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ status: "VULNERABLE", counts: { high: 1 } });
  });

  it("needs a repository and a connected Bitbucket", async () => {
    network();
    signInAs(company.it.lead);
    expect((await check(company.it.project.id)).status).toBe(400);
    await link(company.it.project.id);
    delete process.env.BITBUCKET_TOKEN;
    expect((await check(company.it.project.id)).body.error.code).toBe("AUDIT_NOT_CONFIGURED");
  });
});
