import { format } from "date-fns";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as syncRoute from "@/app/api/integrations/daily-sync/route";
import * as tokensRoute from "@/app/api/me/tokens/route";
import * as tokenRoute from "@/app/api/me/tokens/[id]/route";
import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import { setActivitySummarizer } from "@/lib/ai";
import { Project, Task, User, WeeklyReport } from "@/models";
import { BASE_URL, call, makeCompany, request, resetDatabase, signInAs } from "./helpers";

type Company = Awaited<ReturnType<typeof makeCompany>>;
let company: Company;
const today = format(new Date(), "yyyy-MM-dd");

beforeEach(async () => {
  await resetDatabase();
  company = await makeCompany();
  setActivitySummarizer({
    summarizeActivity: async (activity) => activity.commits.map((commit) => `Did: ${commit.subject}`),
  });
});
afterEach(() => setActivitySummarizer(undefined));

async function tokenFor(person: { _id: unknown }) {
  signInAs(person as Parameters<typeof signInAs>[0]);
  const { body } = await call(tokensRoute.POST, request("POST", "/api/me/tokens", { body: { name: "Laptop" } }));
  signInAs(null);
  return body.data.token as string;
}

function syncRequest(token: string | null, body: object, cookie?: string) {
  return new NextRequest(`${BASE_URL}/api/integrations/daily-sync`, {
    method: "POST",
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const activity = (overrides: object = {}) => ({
  date: today,
  projects: [{ code: "prj", commits: [{ subject: "Add export" }, { subject: "Fix totals" }], ...overrides }],
});
const sync = (token: string | null, body: object = activity()) => call(syncRoute.POST, syncRequest(token, body));
const syncedTask = () =>
  Task.findOne({ userId: company.it.developer._id, source: "sync" }).lean();

describe("API tokens", () => {
  it("are shown once, listed by prefix and stored only as a hash", async () => {
    const token = await tokenFor(company.it.developer);
    expect(token).toMatch(/^wlk_/);
    signInAs(company.it.developer);
    const { body } = await call(tokensRoute.GET, request("GET", "/api/me/tokens"));
    expect(body.data).toHaveLength(1);
    expect(JSON.stringify(body.data)).not.toContain(token);
    expect(token.startsWith(body.data[0].prefix)).toBe(true);
  });

  it("stop working once revoked", async () => {
    const token = await tokenFor(company.it.developer);
    signInAs(company.it.developer);
    const { body } = await call(tokensRoute.GET, request("GET", "/api/me/tokens"));
    signInAs(company.it.otherDeveloper);
    expect((await call(tokenRoute.DELETE, request("DELETE", "/x"), { id: body.data[0].id })).status).toBe(404);
    signInAs(company.it.developer);
    expect((await call(tokenRoute.DELETE, request("DELETE", "/x"), { id: body.data[0].id })).status).toBe(200);
    expect((await sync(token)).status).toBe(401);
  });

  it("stop working when the user is deactivated", async () => {
    const token = await tokenFor(company.it.developer);
    await User.updateOne({ _id: company.it.developer._id }, { isActive: false });
    expect((await sync(token)).status).toBe(401);
  });

  it("can't reach ordinary routes, and the sync route ignores the session cookie", async () => {
    const token = await tokenFor(company.it.developer);
    const viaToken = new NextRequest(`${BASE_URL}/api/tasks?from=${today}&to=${today}`, {
      headers: { host: "localhost:3000", authorization: `Bearer ${token}` },
    });
    expect((await call(tasksRoute.GET, viaToken)).status).toBe(401);
    signInAs(company.it.developer);
    expect((await sync(null)).status).toBe(401);
    expect((await sync("wlk_not-a-real-token")).status).toBe(401);
  });
});

describe("daily sync", () => {
  it("creates one task per project with bullet points and no hours", async () => {
    const token = await tokenFor(company.it.developer);
    const { status, body } = await sync(token);
    expect(status).toBe(200);
    expect(body.data.results).toMatchObject([{ code: "PRJ", outcome: "created" }]);
    const task = await syncedTask();
    expect(task).toMatchObject({ details: "• Did: Add export\n• Did: Fix totals", hours: null, status: "Completed" });
    const report = await WeeklyReport.findById(task!.weeklyReportId).lean();
    expect(report?.totals.taskCount).toBe(1);
  });

  it("refreshes its own task on a second run instead of duplicating it", async () => {
    const token = await tokenFor(company.it.developer);
    await sync(token);
    const { body } = await sync(token, activity({ commits: [{ subject: "Add export" }, { subject: "Add tests" }] }));
    expect(body.data.results[0].outcome).toBe("updated");
    expect(await Task.countDocuments({ userId: company.it.developer._id, source: "sync" })).toBe(1);
    expect((await syncedTask())?.details).toContain("Add tests");
    expect((await sync(token, activity({ commits: [{ subject: "Add export" }, { subject: "Add tests" }] }))).body.data.results[0].outcome).toBe("unchanged");
  });

  it("leaves a task alone once the developer has edited it", async () => {
    const token = await tokenFor(company.it.developer);
    await sync(token);
    const task = await syncedTask();
    signInAs(company.it.developer);
    await call(taskRoute.PATCH, request("PATCH", "/x", { body: { details: "My own words.", hours: 2 } }), { id: String(task!._id) });
    const { body } = await sync(token, activity({ commits: [{ subject: "Something new" }] }));
    expect(body.data.results[0].outcome).toBe("kept");
    expect(await syncedTask()).toMatchObject({ details: "My own words.", hours: 2 });
  });

  it("marks a day of only uncommitted work as in progress", async () => {
    const token = await tokenFor(company.it.developer);
    setActivitySummarizer(null);
    await sync(token, activity({ commits: [], uncommittedFiles: ["src/a.ts", "src/b.ts"] }));
    expect(await syncedTask()).toMatchObject({
      status: "In Progress",
      details: "• In progress: uncommitted changes to a.ts, b.ts",
    });
  });

  it("falls back to commit subjects when the AI fails", async () => {
    const token = await tokenFor(company.it.developer);
    setActivitySummarizer({ summarizeActivity: async () => Promise.reject(new Error("down")) });
    await sync(token);
    expect((await syncedTask())?.details).toBe("• Add export\n• Fix totals");
  });

  it("skips projects that can't be logged, without failing the others", async () => {
    await Project.create({
      departmentId: company.it.department._id,
      name: "Second",
      code: "SEC",
      color: "sky",
      ownerId: company.it.manager._id,
      memberIds: [company.it.developer._id],
      createdBy: company.it.manager._id,
    });
    const token = await tokenFor(company.it.developer);
    const commits = [{ subject: "Work" }];
    const { body } = await sync(token, {
      date: today,
      projects: [
        { code: "NOPE", commits },
        { code: "SEC", commits },
        { code: "PRJ", commits: [] },
      ],
    });
    expect(body.data.results.map((result: { outcome: string }) => result.outcome)).toEqual(["skipped", "created", "skipped"]);
  });

  it("never logs to another department's project with the same code", async () => {
    const token = await tokenFor(company.it.developer);
    await sync(token);
    expect(await Task.countDocuments({ projectId: company.hr.project._id, source: "sync" })).toBe(0);
  });

  it("skips a submitted week", async () => {
    const token = await tokenFor(company.it.developer);
    await sync(token);
    const task = await syncedTask();
    await WeeklyReport.updateOne({ _id: task!.weeklyReportId }, { status: "SUBMITTED" });
    await Task.deleteOne({ _id: task!._id });
    const { body } = await sync(token);
    expect(body.data.results[0]).toMatchObject({ outcome: "skipped" });
    expect(body.data.results[0].message).toMatch(/submitted/);
  });

  it("uses a finished work list as-is, without the AI", async () => {
    const token = await tokenFor(company.it.developer);
    setActivitySummarizer({ summarizeActivity: async () => Promise.reject(new Error("must not be called")) });
    const items = [
      "Super Admin and Director roles are created, and the users page is updated for them.",
      "- The organizations and users flow is updated.",
    ];
    const { body } = await sync(token, { date: today, projects: [{ code: "PRJ", items, status: "In Progress" }] });
    expect(body.data.results[0].outcome).toBe("created");
    expect(await syncedTask()).toMatchObject({
      details:
        "• Super Admin and Director roles are created, and the users page is updated for them.\n• The organizations and users flow is updated.",
      status: "In Progress",
      syncedFrom: "items",
    });
  });

  it("never lets the automatic run replace a /worklog list, but a new list replaces an old one", async () => {
    const token = await tokenFor(company.it.developer);
    await sync(token, { date: today, projects: [{ code: "PRJ", items: ["First list."] }] });
    expect((await sync(token)).body.data.results[0].outcome).toBe("kept");
    expect((await syncedTask())?.details).toBe("• First list.");
    await sync(token, { date: today, projects: [{ code: "PRJ", items: ["Second list."] }] });
    expect((await syncedTask())?.details).toBe("• Second list.");
  });

  it("lets a /worklog list replace the automatic summary", async () => {
    const token = await tokenFor(company.it.developer);
    await sync(token);
    const { body } = await sync(token, { date: today, projects: [{ code: "PRJ", items: ["Written by Claude."] }] });
    expect(body.data.results[0].outcome).toBe("updated");
    expect(await syncedTask()).toMatchObject({ details: "• Written by Claude.", syncedFrom: "items" });
  });

  it("refuses the CEO", async () => {
    const token = await tokenFor(company.ceo);
    expect((await sync(token)).status).toBe(403);
  });
});
