import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "dotenv";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { applyEnvPatch, readEnvSettings, saveEnvSettings } from "@/lib/site-settings/env";
import { getApprovalSettings, saveApprovalSettings } from "@/lib/site-settings/service";
import * as approvalRoute from "@/app/api/site-settings/approval/route";
import * as envRoute from "@/app/api/site-settings/env/route";
import { call, makeUser, request, resetDatabase, signInAs } from "./helpers";

describe("the environment file", () => {
  const original = '# Comment\nAPP_URL="http://localhost:3000"\n\nSENDGRID_API_KEY=""\nOTHER=kept\n';

  it("changes only the named keys and keeps everything else", () => {
    const next = applyEnvPatch(original, { APP_URL: "https://getl.example.com" });
    expect(next).toBe(original.replace("http://localhost:3000", "https://getl.example.com"));
  });

  it("adds a key the file doesn't have", () => {
    expect(parse(applyEnvPatch(original, { CRON_SECRET: "abc" }))).toMatchObject({ CRON_SECRET: "abc", OTHER: "kept" });
  });

  it.each(['pa"ss', "back\slash", "it's", "with # hash", "spaced value"])("round-trips %s", (value) => {
    expect(parse(applyEnvPatch(original, { SENDGRID_API_KEY: value })).SENDGRID_API_KEY).toBe(value);
  });

  it.each(["two\nlines", "cash$money"])("refuses %j", (value) => {
    expect(() => applyEnvPatch(original, { SENDGRID_API_KEY: value })).toThrow();
  });

  describe("saved from the page", () => {
    let dir: string;
    let file: string;
    const saved = { ...process.env };

    beforeEach(async () => {
      await resetDatabase();
      dir = await mkdtemp(join(tmpdir(), "getl-env-"));
      file = join(dir, ".env.local");
      await writeFile(file, original);
    });
    afterEach(async () => {
      process.env = { ...saved };
      await rm(dir, { recursive: true, force: true });
    });

    it("writes the file, keeps a backup and never returns a secret", async () => {
      const admin = await makeUser("SUPER_ADMIN", null, null);
      const { restart } = await saveEnvSettings(admin, { SENDGRID_API_KEY: "SG.secret", DATABASE_URL: "postgresql://u:p@h/db" }, file);
      expect(restart).toEqual(["Database URL"]);
      expect(parse(await readFile(file, "utf8"))).toMatchObject({ SENDGRID_API_KEY: "SG.secret", OTHER: "kept" });
      expect(await readFile(join(dir, ".env.backup.local"), "utf8")).toBe(original);
      expect(process.env.SENDGRID_API_KEY).toBe("SG.secret");

      const { fields } = await readEnvSettings(file);
      expect(fields.find((field) => field.key === "SENDGRID_API_KEY")).toMatchObject({ isSet: true, value: "" });
      expect(JSON.stringify(fields)).not.toContain("SG.secret");

      const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "site.env" } });
      expect(JSON.stringify(log.meta)).not.toContain("SG.secret");
    });

    it.each([
      [{ NODE_OPTIONS: "--inspect" }],
      [{ APP_URL: "" }],
      [{ APP_URL: "not a url" }],
      [{ SUPER_ADMIN_EMAILS: "someone" }],
    ])("refuses %o and leaves the file alone", async (patch) => {
      const admin = await makeUser("SUPER_ADMIN", null, null);
      await expect(saveEnvSettings(admin, patch, file)).rejects.toThrow();
      expect(await readFile(file, "utf8")).toBe(original);
    });
  });
});

describe("exempting Team Leads from reviewing", () => {
  beforeEach(resetDatabase);

  it("is off by default, and passes waiting reports to the Manager when saved", async () => {
    expect(await getApprovalSettings()).toEqual({ teamLeadReview: true });

    const admin = await makeUser("SUPER_ADMIN", null, null);
    const manager = await makeUser("MANAGER", null, null);
    const department = await prisma.department.create({
      data: { name: "Engineering", code: "ENG", color: "teal", managerId: manager.id },
    });
    await prisma.user.update({ where: { id: manager.id }, data: { departmentId: department.id } });
    const lead = await makeUser("TEAM_LEAD", department.id, manager.id);
    const dev = await makeUser("DEVELOPER", department.id, lead.id);
    const week = { isoYear: 2026, weekStart: new Date("2026-11-16"), weekEnd: new Date("2026-11-22") };
    const waiting = await prisma.weeklyReport.create({
      data: { ...week, isoWeek: 47, userId: dev.id, departmentId: department.id, status: "SUBMITTED", currentApproverId: lead.id },
    });
    const draft = await prisma.weeklyReport.create({
      data: { ...week, isoWeek: 46, userId: dev.id, departmentId: department.id },
    });

    expect(await saveApprovalSettings(admin, { teamLeadReview: false })).toMatchObject({ rerouted: 1 });
    expect(await getApprovalSettings()).toEqual({ teamLeadReview: false });
    expect(await prisma.weeklyReport.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({
      status: "SUBMITTED",
      currentApproverId: manager.id,
    });
    expect((await prisma.weeklyReport.findUniqueOrThrow({ where: { id: draft.id } })).currentApproverId).toBeNull();
    expect(await prisma.notification.count({ where: { recipientId: manager.id, reportId: waiting.id } })).toBe(1);
  });
});

describe("the site settings API", () => {
  beforeEach(resetDatabase);

  it.each(["CEO", "MANAGER", "TEAM_LEAD", "DEVELOPER"] as const)("is closed to a %s", async (role) => {
    signInAs(await makeUser(role, null, null));
    const patch = (body: object) => request("PATCH", "/x", { body });
    expect((await call(approvalRoute.GET, request("GET", "/x"))).status).toBe(403);
    expect((await call(approvalRoute.PATCH, patch({ teamLeadReview: false }))).status).toBe(403);
    expect((await call(envRoute.GET, request("GET", "/x"))).status).toBe(403);
    expect((await call(envRoute.PATCH, patch({ values: { APP_URL: "https://x.example.com" } }))).status).toBe(403);
    expect(await getApprovalSettings()).toEqual({ teamLeadReview: true });
  });

  it("lets a Super Admin change the approval chain", async () => {
    signInAs(await makeUser("SUPER_ADMIN", null, null));
    const { status, body } = await call(approvalRoute.PATCH, request("PATCH", "/x", { body: { teamLeadReview: false } }));
    expect(status).toBe(200);
    expect(body.data).toEqual({ settings: { teamLeadReview: false }, rerouted: 0 });
  });
});
