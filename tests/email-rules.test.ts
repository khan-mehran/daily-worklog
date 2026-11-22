import { format } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as projectsRoute from "@/app/api/projects/route";
import * as membersRoute from "@/app/api/projects/[id]/members/route";
import * as submitRoute from "@/app/api/reports/[id]/submit/route";
import * as tasksRoute from "@/app/api/tasks/route";
import { prisma } from "@/lib/db/prisma";
import { sendEmailSafely } from "@/lib/email";
import type * as EmailModule from "@/lib/email";
import { notify } from "@/lib/notifications";
import { call, makeCompany, request, resetDatabase, signInAs } from "./helpers";

type Company = Awaited<ReturnType<typeof makeCompany>>;
let company: Company;

const emailed = () => vi.mocked(sendEmailSafely).mock.calls.map((args) => args[0].to).sort();
const notified = async (type: "PROJECT_ASSIGNED" | "REPORT_SUBMITTED") =>
  (await prisma.notification.findMany({ where: { type }, select: { recipientId: true } }))
    .map((note) => note.recipientId)
    .sort();

beforeEach(async () => {
  await resetDatabase();
  company = await makeCompany();
  await prisma.notification.deleteMany();
  vi.mocked(sendEmailSafely).mockClear();
});

describe("project assignment", () => {
  const create = (memberIds: string[]) =>
    call(
      projectsRoute.POST,
      request("POST", "/api/projects", { body: { name: "Portal", code: "PORTAL", color: "sky", memberIds } }),
    );
  const members = (body: { add?: string[]; remove?: string[] }) =>
    call(membersRoute.POST, request("POST", "/x", { body }), { id: company.it.project.id });

  it("emails and notifies everyone assigned when a project is created", async () => {
    const { developer, otherDeveloper, manager } = company.it;
    signInAs(manager);
    const { status, body } = await create([developer.id, otherDeveloper.id]);
    expect(status).toBe(201);
    expect(emailed()).toEqual([developer.email, otherDeveloper.email].sort());
    expect(await notified("PROJECT_ASSIGNED")).toEqual([developer.id, otherDeveloper.id].sort());

    const [mail] = vi.mocked(sendEmailSafely).mock.calls[0]!;
    expect(mail.subject).toBe("You've been assigned to Portal");
    expect(mail.text).toContain(`/projects/${body.data.id}`);
  });

  it("doesn't tell the person who made the assignment about adding themselves", async () => {
    const { lead, developer } = company.it;
    signInAs(lead);
    await create([lead.id, developer.id]);
    expect(emailed()).toEqual([developer.email]);
  });

  it("emails only people who weren't on the project already", async () => {
    const { manager, developer, otherDeveloper } = company.it;
    signInAs(manager);
    // The fixture's developer is already a member; the other developer is new.
    expect((await members({ add: [developer.id, otherDeveloper.id] })).status).toBe(200);
    expect(emailed()).toEqual([otherDeveloper.email]);
    expect(await notified("PROJECT_ASSIGNED")).toEqual([otherDeveloper.id]);
  });

  it("sends nothing when people are only removed", async () => {
    signInAs(company.it.manager);
    await members({ remove: [company.it.developer.id] });
    expect(sendEmailSafely).not.toHaveBeenCalled();
    expect(await notified("PROJECT_ASSIGNED")).toEqual([]);
  });

  it("respects someone turning email off, and still tells them in the app", async () => {
    const { manager, otherDeveloper } = company.it;
    await prisma.user.update({ where: { id: otherDeveloper.id }, data: { emailNotifications: false } });
    signInAs(manager);
    await members({ add: [otherDeveloper.id] });
    expect(sendEmailSafely).not.toHaveBeenCalled();
    expect(await notified("PROJECT_ASSIGNED")).toEqual([otherDeveloper.id]);
  });
});

describe("the CEO is never emailed", () => {
  it("stores the notification and sends no email, even when email was asked for", async () => {
    const sent = await notify({
      recipientId: company.ceo.id,
      departmentId: null,
      type: "REPORT_APPROVED",
      title: "Approved",
      message: "A report was approved.",
      email: true,
    });
    expect(sent).toBe(true);
    expect(sendEmailSafely).not.toHaveBeenCalled();
    expect(await prisma.notification.count({ where: { recipientId: company.ceo.id } })).toBe(1);
  });

  it("a Manager's submitted week reaches the CEO in the app only", async () => {
    signInAs(company.it.manager);
    const body = {
      projectId: company.it.project.id,
      details: "Planned the quarter",
      hours: 2,
      date: format(new Date(), "yyyy-MM-dd"),
    };
    expect((await call(tasksRoute.POST, request("POST", "/api/tasks", { body }))).status).toBe(201);
    const report = await prisma.weeklyReport.findFirstOrThrow({
      where: { userId: company.it.manager.id, status: "DRAFT" },
    });
    const submitted = await call(submitRoute.POST, request("POST", "/x"), { id: report.id });
    expect(submitted.body.data.status).toBe("SUBMITTED");
    expect(await notified("REPORT_SUBMITTED")).toEqual([company.ceo.id]);
    expect(sendEmailSafely).not.toHaveBeenCalled();
  });
});

describe("SendGrid", () => {
  const message = { to: " dev@example.com ", subject: "Hello", text: "plain", html: "<p>rich</p>" };
  const realEmail = () => vi.importActual<typeof EmailModule>("@/lib/email");

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts the message to the Mail Send API with the configured sender", async () => {
    vi.stubEnv("SENDGRID_API_KEY", "SG.test-key");
    vi.stubEnv("SENDGRID_FROM_EMAIL", "GET List <no-reply@example.com>");
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await (await realEmail()).sendEmailSafely(message)).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer SG.test-key");
    expect(JSON.parse(init.body as string)).toEqual({
      personalizations: [{ to: [{ email: "dev@example.com" }] }],
      from: { email: "no-reply@example.com", name: "GET List" },
      subject: "Hello",
      content: [
        { type: "text/plain", value: "plain" },
        { type: "text/html", value: "<p>rich</p>" },
      ],
    });
  });

  it("reports failure instead of throwing when SendGrid refuses or isn't configured", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEmailSafely: send } = await realEmail();

    vi.stubEnv("SENDGRID_API_KEY", "");
    vi.stubEnv("SENDGRID_FROM_EMAIL", "");
    const fetchMock = vi.fn(async () => new Response("forbidden", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await send(message)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("SENDGRID_API_KEY", "SG.test-key");
    vi.stubEnv("SENDGRID_FROM_EMAIL", "no-reply@example.com");
    expect(await send(message)).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    quiet.mockRestore();
  });
});
