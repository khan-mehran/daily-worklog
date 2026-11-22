import { addDays, startOfISOWeek, subDays } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as notificationsRoute from "@/app/api/notifications/route";
import * as readRoute from "@/app/api/notifications/read/route";
import * as streamRoute from "@/app/api/notifications/stream/route";
import * as cronRoute from "@/app/api/cron/reminders/route";
import * as meRoute from "@/app/api/me/route";
import { sendEmailSafely } from "@/lib/email";
import { notify } from "@/lib/notifications";
import { isoWeekOf } from "@/lib/reports/iso-week";
import { sendReminders } from "@/lib/reminders/service";
import { autoSubmitReports } from "@/lib/reports/auto-submit";
import { AUTO_SUBMIT_COMMENT } from "@/lib/reports/service";
import { prisma } from "@/lib/db/prisma";
import { call, makeCompany, request, resetDatabase, signInAs } from "./helpers";

type Company = Awaited<ReturnType<typeof makeCompany>>;
let company: Company;

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(sendEmailSafely).mockClear();
  company = await makeCompany();
});

describe("notifications API", () => {
  it("lists only the caller's own notifications, with the unread count", async () => {
    signInAs(company.it.manager);
    const { body } = await call(notificationsRoute.GET, request("GET", "/api/notifications"));
    expect(body.data.map((row: { message: string }) => row.message)).toEqual(["IT notification"]);
    expect(body.meta.unread).toBe(1);
    signInAs(company.hr.manager);
    const other = await call(notificationsRoute.GET, request("GET", "/api/notifications"));
    expect(other.body.data.map((row: { message: string }) => row.message)).toEqual(["HR notification"]);
  });

  it("can't mark someone else's notification as read", async () => {
    signInAs(company.hr.manager);
    const { body } = await call(
      readRoute.POST,
      request("POST", "/x", { body: { ids: [company.it.notification.id] } }),
    );
    expect(body.data.updated).toBe(0);
    expect((await prisma.notification.findUnique({ where: { id: company.it.notification.id } }))?.readAt).toBeNull();
  });

  it("marks one or all as read", async () => {
    signInAs(company.it.manager);
    await prisma.notification.create({ data: { recipientId: company.it.manager.id, departmentId: null, type: "REMINDER", title: "t", message: "m" } });
    await call(readRoute.POST, request("POST", "/x", { body: { ids: [company.it.notification.id] } }));
    expect((await call(notificationsRoute.GET, request("GET", "/x"))).body.meta.unread).toBe(1);
    await call(readRoute.POST, request("POST", "/x", { body: { all: true } }));
    expect((await call(notificationsRoute.GET, request("GET", "/x"))).body.meta.unread).toBe(0);
  });

  it("streams the unread count and new notifications for the caller only", async () => {
    signInAs(company.it.manager);
    const controller = new AbortController();
    const req = request("GET", "/api/notifications/stream");
    const response = await streamRoute.GET(
      new (req.constructor as typeof Request)(req, { signal: controller.signal }) as typeof req,
      { params: Promise.resolve({}) },
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: unread");
    expect(first).toContain('"count":1');
    controller.abort();
    await reader.cancel();
  });

  it("respects email and in-app preferences", async () => {
    await prisma.user.updateMany({ where: { id: company.it.lead.id }, data: { emailNotifications: false, inAppNotifications: false } });
    await notify({ recipientId: company.it.lead.id, departmentId: null, type: "REPORT_SUBMITTED", title: "t", message: "m", email: true });
    expect(sendEmailSafely).not.toHaveBeenCalled();
    expect(await prisma.notification.count({ where: { recipientId: company.it.lead.id } })).toBe(0);
  });
});

describe("reminders", () => {
  const friday5pm = () => addDays(startOfISOWeek(new Date()), 4).setHours(17, 0, 0, 0);

  it("before Friday 4 PM, nobody is reminded to submit", async () => {
    const monday = addDays(startOfISOWeek(new Date()), 0);
    monday.setHours(10);
    expect((await sendReminders(monday)).submitReminders).toBe(0);
  });

  it("after Friday 4 PM, reminds everyone who hasn't submitted, once", async () => {
    const now = new Date(friday5pm());
    const week = isoWeekOf(now);
    await prisma.weeklyReport.create({ data: {
      userId: company.it.developer.id,
      departmentId: company.it.department.id,
      ...week,
      status: "SUBMITTED",
    } });
    const first = await sendReminders(now);
    // 8 non-CEO people across two departments, one of whom has submitted.
    expect(first.submitReminders).toBe(7);
    expect(await prisma.notification.findFirst({ where: { recipientId: company.it.developer.id, type: "REMINDER" } })).toBeNull();
    expect((await sendReminders(now)).submitReminders).toBe(0);
  });

  it("reminds an approver once a day about reports waiting over two days", async () => {
    const now = new Date();
    const report = await prisma.weeklyReport.create({ data: {
      userId: company.it.otherDeveloper.id,
      departmentId: company.it.department.id,
      isoYear: 2025,
      isoWeek: 2,
      weekStart: new Date("2025-01-06"),
      weekEnd: new Date("2025-01-12"),
      status: "SUBMITTED",
      currentApproverId: company.it.lead.id,
    } });
    // Written directly, because Prisma sets updatedAt itself on every update.
    await prisma.$executeRaw`UPDATE "WeeklyReport" SET "updatedAt" = ${subDays(now, 3)} WHERE "id" = ${report.id}::uuid`;
    expect((await sendReminders(now)).reviewReminders).toBe(1);
    expect((await sendReminders(now)).reviewReminders).toBe(0);
    const note = await prisma.notification.findFirst({ where: { recipientId: company.it.lead.id, type: "REMINDER" } });
    expect(note?.link).toBe(`/reports/${report.id}`);
  });

  it("the cron endpoint needs the secret", async () => {
    process.env.CRON_SECRET = "test-secret-value";
    expect((await call(cronRoute.GET, request("GET", "/api/cron/reminders"))).status).toBe(401);
    const wrong = new Request("http://localhost:3000/api/cron/reminders", { headers: { authorization: "Bearer nope" } });
    expect((await call(cronRoute.GET, wrong as never)).status).toBe(401);
    const right = new Request("http://localhost:3000/api/cron/reminders", { headers: { authorization: "Bearer test-secret-value" } });
    const ok = await call(cronRoute.GET, right as never);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toHaveProperty("reviewReminders");
  });
});

describe("Thursday auto-submit", () => {
  const thursdayAt = (hour: number) => new Date(addDays(startOfISOWeek(new Date()), 3).setHours(hour, 0, 0, 0));
  const draft = (userId: string, taskCount = 1) =>
    prisma.weeklyReport.create({ data: {
      userId,
      departmentId: company.it.department.id,
      ...isoWeekOf(thursdayAt(19)),
      status: "DRAFT",
      taskCount,
    } });
  const statusOf = async (id: string) => (await prisma.weeklyReport.findUniqueOrThrow({ where: { id } })).status;

  it("does nothing before Thursday 6 PM, or once Thursday is over", async () => {
    const report = await draft(company.it.developer.id);
    expect(await autoSubmitReports(thursdayAt(17))).toEqual({ autoSubmitted: 0 });
    expect(await autoSubmitReports(addDays(thursdayAt(10), 1))).toEqual({ autoSubmitted: 0 });
    expect(await statusOf(report.id)).toBe("DRAFT");
  });

  it("submits Developers' and Team Leads' drafts to their approvers, once", async () => {
    const developers = await draft(company.it.developer.id);
    const leads = await draft(company.it.lead.id);
    const managers = await draft(company.it.manager.id);
    const empty = await draft(company.it.otherDeveloper.id, 0);

    expect(await autoSubmitReports(thursdayAt(18))).toEqual({ autoSubmitted: 2 });
    expect(await prisma.weeklyReport.findUniqueOrThrow({ where: { id: developers.id } })).toMatchObject({
      status: "SUBMITTED",
      currentApproverId: company.it.lead.id,
    });
    expect(await prisma.weeklyReport.findUniqueOrThrow({ where: { id: leads.id } })).toMatchObject({
      status: "SUBMITTED",
      currentApproverId: company.it.manager.id,
    });
    expect(await statusOf(managers.id)).toBe("DRAFT");
    expect(await statusOf(empty.id)).toBe("DRAFT");

    const trail = await prisma.reportTrailEntry.findFirstOrThrow({ where: { reportId: developers.id } });
    expect(trail).toMatchObject({ action: "SUBMITTED", byUserId: company.it.developer.id, comment: AUTO_SUBMIT_COMMENT });
    const told = await prisma.notification.findMany({ where: { reportId: developers.id }, select: { recipientId: true } });
    expect(told.map((row) => row.recipientId).sort()).toEqual([company.it.developer.id, company.it.lead.id].sort());

    expect(await autoSubmitReports(thursdayAt(19))).toEqual({ autoSubmitted: 0 });
  });

  it("leaves a report that was sent back for changes", async () => {
    const report = await draft(company.it.developer.id);
    await prisma.weeklyReport.update({ where: { id: report.id }, data: { status: "CHANGES_REQUESTED" } });
    expect(await autoSubmitReports(thursdayAt(19))).toEqual({ autoSubmitted: 0 });
  });
});

describe("profile", () => {
  it("changes the caller's name only", async () => {
    signInAs(company.it.developer);
    await call(meRoute.PATCH, request("PATCH", "/api/me", { body: { name: "Renamed Dev", role: "CEO" } }));
    const user = await prisma.user.findUnique({ where: { id: company.it.developer.id } });
    expect(user).toMatchObject({ name: "Renamed Dev", role: "DEVELOPER" });
  });
});
