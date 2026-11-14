import { addDays, startOfISOWeek, subDays } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as notificationsRoute from "@/app/api/notifications/route";
import * as readRoute from "@/app/api/notifications/read/route";
import * as streamRoute from "@/app/api/notifications/stream/route";
import * as cronRoute from "@/app/api/cron/reminders/route";
import * as passwordRoute from "@/app/api/me/password/route";
import * as meRoute from "@/app/api/me/route";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { sendEmailSafely } from "@/lib/email";
import { notify } from "@/lib/notifications";
import { isoWeekOf } from "@/lib/reports/iso-week";
import { sendReminders } from "@/lib/reminders/service";
import { Notification, User, WeeklyReport } from "@/models";
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
      request("POST", "/x", { body: { ids: [String(company.it.notification._id)] } }),
    );
    expect(body.data.updated).toBe(0);
    expect((await Notification.findById(company.it.notification._id).lean())?.readAt).toBeNull();
  });

  it("marks one or all as read", async () => {
    signInAs(company.it.manager);
    await Notification.create({ recipientId: company.it.manager._id, departmentId: null, type: "REMINDER", title: "t", message: "m" });
    await call(readRoute.POST, request("POST", "/x", { body: { ids: [String(company.it.notification._id)] } }));
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
    await User.updateOne(
      { _id: company.it.lead._id },
      { "preferences.emailNotifications": false, "preferences.inAppNotifications": false },
    );
    await notify({ recipientId: company.it.lead._id, departmentId: null, type: "REPORT_SUBMITTED", title: "t", message: "m", email: true });
    expect(sendEmailSafely).not.toHaveBeenCalled();
    expect(await Notification.countDocuments({ recipientId: company.it.lead._id })).toBe(0);
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
    await WeeklyReport.create({
      userId: company.it.developer._id,
      departmentId: company.it.department._id,
      ...week,
      status: "SUBMITTED",
    });
    const first = await sendReminders(now);
    // 8 non-CEO people across two departments, one of whom has submitted.
    expect(first.submitReminders).toBe(7);
    expect(await Notification.exists({ recipientId: company.it.developer._id, type: "REMINDER" })).toBeNull();
    expect((await sendReminders(now)).submitReminders).toBe(0);
  });

  it("reminds an approver once a day about reports waiting over two days", async () => {
    const now = new Date();
    const report = await WeeklyReport.create({
      userId: company.it.otherDeveloper._id,
      departmentId: company.it.department._id,
      isoYear: 2025,
      isoWeek: 2,
      weekStart: new Date("2025-01-06"),
      weekEnd: new Date("2025-01-12"),
      status: "SUBMITTED",
      currentApproverId: company.it.lead._id,
    });
    await WeeklyReport.collection.updateOne({ _id: report._id }, { $set: { updatedAt: subDays(now, 3) } });
    expect((await sendReminders(now)).reviewReminders).toBe(1);
    expect((await sendReminders(now)).reviewReminders).toBe(0);
    const note = await Notification.findOne({ recipientId: company.it.lead._id, type: "REMINDER" }).lean();
    expect(note?.link).toBe(`/reports/${report._id}`);
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

describe("profile and password", () => {
  it("changes the caller's name only", async () => {
    signInAs(company.it.developer);
    await call(meRoute.PATCH, request("PATCH", "/api/me", { body: { name: "Renamed Dev", role: "CEO" } }));
    const user = await User.findById(company.it.developer._id).lean();
    expect(user).toMatchObject({ name: "Renamed Dev", role: "DEVELOPER" });
  });

  it("needs the current password to change it", async () => {
    await User.updateOne({ _id: company.it.developer._id }, { passwordHash: await hashPassword("old-password-1") });
    signInAs(company.it.developer);
    const change = (currentPassword: string) =>
      call(
        passwordRoute.POST,
        request("POST", "/x", { body: { currentPassword, newPassword: "new-password-2", confirmPassword: "new-password-2" } }),
      );
    expect((await change("wrong-password")).body.error.code).toBe("WRONG_PASSWORD");
    expect((await change("old-password-1")).status).toBe(200);
    const user = await User.findById(company.it.developer._id).select("+passwordHash").lean();
    expect(await verifyPassword("new-password-2", user?.passwordHash)).toBe(true);
  });
});
