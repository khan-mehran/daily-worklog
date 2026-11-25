import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as connectionRoute from "@/app/api/bitbucket/connection/route";
import * as managerRoute from "@/app/api/departments/[id]/manager/route";
import * as importRoute from "@/app/api/projects/import/route";
import { auditProject, runDueAudits } from "@/lib/audit/service";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { prisma } from "@/lib/db/prisma";
import { call, makeCompany, makeUser, request, resetDatabase, signInAs } from "./helpers";

type Company = Awaited<ReturnType<typeof makeCompany>>;
let company: Company;

const TOKEN = "ATATT-super-secret-token";
const REPOSITORIES = [
  { full_name: "acme/portal", name: "Customer Portal", slug: "portal", description: "The portal." },
  { full_name: "acme/prj", name: "Prj", slug: "prj", description: "" },
  { full_name: "acme/a-very-long-repository-name", name: "Long", slug: "a-very-long-repository-name" },
];

interface Network {
  repositories?: object[];
  unauthorized?: boolean;
}

/** Stands in for Bitbucket. Returns the requests made, with the Authorization header each carried. */
function network({ repositories = REPOSITORIES, unauthorized = false }: Network = {}) {
  const requests: { url: string; authorization: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, authorization: (init?.headers as Record<string, string>)?.Authorization ?? "" });
      if (unauthorized) return new Response("", { status: 401 });
      if (url.startsWith("https://api.bitbucket.org/2.0/user/workspaces")) {
        return Response.json({ values: [{ workspace: { slug: "acme" } }] });
      }
      if (url.startsWith("https://api.bitbucket.org/2.0/repositories/other?")) {
        return Response.json({ values: [{ full_name: "other/site", name: "Site", slug: "site" }] });
      }
      if (url.startsWith("https://api.bitbucket.org/2.0/repositories/acme?")) {
        // Two pages, to follow "next".
        return url.includes("page=2")
          ? Response.json({ values: repositories.slice(1) })
          : Response.json({ values: repositories.slice(0, 1), next: "https://api.bitbucket.org/2.0/repositories/acme?page=2" });
      }
      if (url.startsWith("https://api.bitbucket.org/")) return new Response("", { status: 404 });
      if (url.startsWith("https://registry.npmjs.org/")) return Response.json({});
      throw new Error(`Unexpected request to ${url}`);
    }),
  );
  return requests;
}

const connect = (body: object) => call(connectionRoute.PUT, request("PUT", "/api/bitbucket/connection", { body }));
const preview = () => call(importRoute.GET, request("GET", "/api/projects/import"));
const runImport = () => call(importRoute.POST, request("POST", "/api/projects/import"));
const stored = (departmentId: string) => prisma.bitbucketConnection.findUnique({ where: { departmentId } });

beforeEach(async () => {
  await resetDatabase();
  process.env.AUTH_SECRET = "test-secret-of-reasonable-length";
  delete process.env.BITBUCKET_TOKEN;
  delete process.env.BITBUCKET_USERNAME;
  company = await makeCompany();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("encrypting a secret", () => {
  it("round-trips, and never produces the same text twice", () => {
    const first = encryptSecret(TOKEN);
    expect(first).not.toContain(TOKEN);
    expect(encryptSecret(TOKEN)).not.toBe(first);
    expect(decryptSecret(first)).toBe(TOKEN);
  });

  it("can't be read with another key, or after it was altered", () => {
    const sealed = encryptSecret(TOKEN);
    const parts = sealed.split(".");
    parts[3] = Buffer.from("something else").toString("base64url");
    expect(decryptSecret(parts.join("."))).toBeNull();
    expect(decryptSecret("not a sealed value")).toBeNull();
    process.env.AUTH_SECRET = "a-different-secret-entirely";
    expect(decryptSecret(sealed)).toBeNull();
  });
});

describe("connecting Bitbucket", () => {
  it("is for the department's manager only", async () => {
    network();
    for (const person of [company.it.lead, company.it.developer, company.ceo]) {
      signInAs(person);
      expect((await connect({ username: "me@example.test", token: TOKEN })).status).toBe(403);
      expect((await call(connectionRoute.GET, request("GET", "/x"))).status).toBe(403);
      expect((await preview()).status).toBe(403);
      expect((await runImport()).status).toBe(403);
    }
    expect(await prisma.bitbucketConnection.count()).toBe(0);
  });

  it("stores the token encrypted, and never sends it back", async () => {
    const requests = network();
    signInAs(company.it.manager);
    const { status, body } = await connect({ username: "me@example.test", token: TOKEN });
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ connected: true, username: "me@example.test", workspace: null, readable: true });
    expect(JSON.stringify(body)).not.toContain(TOKEN);

    const row = await stored(company.it.department.id);
    expect(row?.tokenCipher).not.toContain(TOKEN);
    expect(decryptSecret(row!.tokenCipher)).toBe(TOKEN);
    // Nothing in the database holds the token as it was typed.
    const [dumped] = await prisma.$queryRaw<{ dump: string }[]>`
      SELECT (SELECT string_agg(c::text, '') FROM "BitbucketConnection" c) || (SELECT string_agg(a::text, '') FROM "AuditLog" a) AS dump`;
    expect(dumped!.dump).toContain("me@example.test");
    expect(dumped!.dump).not.toContain(TOKEN);

    expect(requests[0]!.authorization).toBe(`Basic ${Buffer.from(`me@example.test:${TOKEN}`).toString("base64")}`);
    const read = await call(connectionRoute.GET, request("GET", "/x"));
    expect(JSON.stringify(read.body)).not.toContain(TOKEN);
  });

  it("refuses a token Bitbucket rejects", async () => {
    network({ unauthorized: true });
    signInAs(company.it.manager);
    const { status, body } = await connect({ token: "wrong" });
    expect(status).toBe(400);
    expect(body.error.code).toBe("BITBUCKET_REJECTED");
    expect(await stored(company.it.department.id)).toBeNull();
    expect((await connect({ username: "me@example.test" })).status).toBe(400);
  });

  it("keeps the saved token when only the other fields change, and can be removed", async () => {
    network();
    signInAs(company.it.manager);
    await connect({ username: "me@example.test", token: TOKEN });
    expect((await connect({ username: "", workspace: "acme" })).status).toBe(200);
    const row = await stored(company.it.department.id);
    expect(row).toMatchObject({ username: null, workspace: "acme" });
    expect(decryptSecret(row!.tokenCipher)).toBe(TOKEN);

    expect((await call(connectionRoute.DELETE, request("DELETE", "/x"))).status).toBe(200);
    expect(await stored(company.it.department.id)).toBeNull();
  });

  it("leaves with the manager when the department gets a new one", async () => {
    network();
    signInAs(company.it.manager);
    await connect({ token: TOKEN });
    const next = await makeUser("MANAGER", null, null);
    signInAs(company.ceo);
    const changed = await call(
      managerRoute.POST,
      request("POST", "/x", { body: { mode: "existing", userId: next.id } }),
      { id: company.it.department.id },
    );
    expect(changed.status).toBe(200);
    expect(await stored(company.it.department.id)).toBeNull();
  });
});

describe("a Super Admin who leads a department", () => {
  it("connects Bitbucket and imports into that department, like its manager", async () => {
    network();
    const admin = await makeUser("SUPER_ADMIN", null, null);
    const led = await prisma.department.create({
      data: { name: "IT Department", code: "ITD", color: "teal", managerId: admin.id, createdBy: admin.id },
    });
    signInAs(admin);
    expect((await connect({ username: "me@example.test", token: TOKEN })).status).toBe(200);
    expect(await stored(led.id)).not.toBeNull();
    expect((await preview()).body.data.repositories).toHaveLength(3);
    expect((await runImport()).body.data).toEqual({ imported: 3, remaining: 0 });
    expect(await prisma.project.count({ where: { departmentId: led.id, ownerId: admin.id } })).toBe(3);
  });

  it("gets nothing without a department of their own", async () => {
    network();
    signInAs(await makeUser("SUPER_ADMIN", null, null));
    expect((await connect({ token: TOKEN })).status).toBe(403);
    expect((await preview()).status).toBe(403);
  });
});

describe("importing projects", () => {
  beforeEach(async () => {
    network();
    signInAs(company.it.manager);
    await connect({ username: "me@example.test", token: TOKEN });
  });

  it("offers nothing until Bitbucket is connected", async () => {
    signInAs(company.hr.manager);
    expect((await preview()).body.data).toEqual({ connected: false, repositories: [], error: null });
    expect((await runImport()).body.error.code).toBe("BITBUCKET_NOT_CONNECTED");
  });

  it("offers the repositories that aren't projects yet", async () => {
    await prisma.project.update({ where: { id: company.it.project.id }, data: { repository: "Acme/Portal/apps/web" } });
    const { body } = await preview();
    expect(body.data).toEqual({
      connected: true,
      repositories: ["acme/a-very-long-repository-name", "acme/prj"],
      error: null,
    });
  });

  it("imports from every workspace that is named, and refuses one that doesn't exist", async () => {
    expect((await connect({ workspace: "acme, missing" })).status).toBe(400);
    expect((await connect({ workspace: "acme,other , acme" })).status).toBe(200);
    expect((await stored(company.it.department.id))?.workspace).toBe("acme, other");
    expect((await preview()).body.data.repositories).toEqual([
      "acme/a-very-long-repository-name",
      "acme/portal",
      "acme/prj",
      "other/site",
    ]);
    expect((await connect({ workspace: "not a workspace!" })).status).toBe(400);
  });

  it("adds a project for each repository, in the manager's department, once", async () => {
    const { status, body } = await runImport();
    expect(status).toBe(201);
    expect(body.data).toEqual({ imported: 3, remaining: 0 });

    const projects = await prisma.project.findMany({
      where: { departmentId: company.it.department.id, repository: { not: null } },
      orderBy: { repository: "asc" },
      include: { members: true },
    });
    expect(projects.map((project) => [project.name, project.code, project.repository])).toEqual([
      ["Long", "AVERYLONGR", "acme/a-very-long-repository-name"],
      ["Customer Portal", "PORTAL", "acme/portal"],
      // The fixture's project already has the code PRJ.
      ["Prj", "PRJ2", "acme/prj"],
    ]);
    expect(projects[1]).toMatchObject({ description: "The portal.", status: "Active", ownerId: company.it.manager.id, members: [] });
    expect(await prisma.project.count({ where: { departmentId: company.hr.department.id } })).toBe(1);

    expect((await runImport()).body.data).toEqual({ imported: 0, remaining: 0 });
    expect((await preview()).body.data.repositories).toEqual([]);
    expect(await prisma.project.count({ where: { departmentId: company.it.department.id } })).toBe(4);
  });

  it("reports a Bitbucket problem instead of failing the page", async () => {
    network({ unauthorized: true });
    const { status, body } = await preview();
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ connected: true, repositories: [] });
    expect(body.data.error).toContain("rejected the token");
    expect((await runImport()).status).toBe(400);
  });

  it("says so when the saved token can no longer be read", async () => {
    process.env.AUTH_SECRET = "a-different-secret-entirely";
    expect((await preview()).body.data.error).toContain("Enter it again");
    const read = await call(connectionRoute.GET, request("GET", "/x"));
    expect(read.body.data.readable).toBe(false);
  });
});

describe("the audit with a department's own account", () => {
  it("reads the lockfile with the department's token, and the daily run covers only connected departments", async () => {
    const requests = network();
    signInAs(company.it.manager);
    await connect({ token: TOKEN });
    const project = await prisma.project.update({ where: { id: company.it.project.id }, data: { repository: "acme/portal" } });
    await prisma.project.update({ where: { id: company.hr.project.id }, data: { repository: "acme/hr" } });

    requests.length = 0;
    await auditProject(project);
    expect(requests[0]).toEqual({
      url: "https://api.bitbucket.org/2.0/repositories/acme/portal/src/HEAD/package-lock.json",
      authorization: `Bearer ${TOKEN}`,
    });

    expect(await runDueAudits(new Date(Date.now() + 48 * 60 * 60 * 1000))).toMatchObject({ configured: true, checked: 1 });
    expect(await prisma.projectAudit.findUnique({ where: { projectId: company.hr.project.id } })).toBeNull();
  });
});
