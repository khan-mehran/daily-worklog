import { subWeeks } from "date-fns";
import { NextRequest } from "next/server";
import mongoose, { Types } from "mongoose";
import { vi } from "vitest";
import { auth } from "@/lib/auth";
import type { Role } from "@/lib/constants";
import { connectDB } from "@/lib/db/connect";
import { isoWeekOf } from "@/lib/reports/iso-week";
import { Department, Notification, Project, Task, User, WeeklyReport } from "@/models";

/**
 * The fixture's approved report sits four weeks back: inside the six-week dashboards, and clear
 * of the current and previous weeks, where tests log new work.
 */
export const FIXTURE_WEEK = isoWeekOf(subWeeks(new Date(), 4));

export const BASE_URL = "http://localhost:3000";

export async function resetDatabase() {
  await connectDB();
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
}

export function signInAs(user: { _id: Types.ObjectId } | null) {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(
    user ? { user: { id: String(user._id) } } : null,
  );
}

let emailCounter = 0;

export async function makeUser(
  role: Role,
  departmentId: Types.ObjectId | null,
  reportsTo: Types.ObjectId | null,
  name = `${role} ${++emailCounter}`,
) {
  return User.create({
    name,
    email: `user${++emailCounter}@test.local`,
    role,
    departmentId,
    reportsTo,
  });
}

/** One department with the full chain: manager, lead, two developers, a project and records. */
export async function makeDepartment(name: string, ceoId: Types.ObjectId) {
  const departmentId = new Types.ObjectId();
  const manager = await makeUser("MANAGER", departmentId, ceoId);
  const lead = await makeUser("TEAM_LEAD", departmentId, manager._id);
  const developer = await makeUser("DEVELOPER", departmentId, lead._id);
  const otherDeveloper = await makeUser("DEVELOPER", departmentId, lead._id);
  const department = await Department.create({
    _id: departmentId,
    name,
    code: name.toUpperCase().slice(0, 8),
    color: "teal",
    managerId: manager._id,
    createdBy: ceoId,
  });
  const project = await Project.create({
    departmentId,
    name: `${name} project`,
    code: "PRJ",
    color: "teal",
    ownerId: manager._id,
    memberIds: [developer._id, lead._id],
    createdBy: manager._id,
  });
  const report = await WeeklyReport.create({
    userId: developer._id,
    departmentId,
    ...FIXTURE_WEEK,
    status: "MANAGER_APPROVED",
    totals: {
      hours: 8,
      taskCount: 1,
      completedCount: 1,
      blockedCount: 0,
      byProject: [{ projectId: project._id, hours: 8, taskCount: 1 }],
    },
  });
  const task = await Task.create({
    userId: developer._id,
    departmentId,
    projectId: project._id,
    date: FIXTURE_WEEK.weekStart,
    details: `${name} secret task`,
    hours: 8,
    status: "Completed",
    weeklyReportId: report._id,
    reportStatus: "MANAGER_APPROVED",
  });
  const notification = await Notification.create({
    recipientId: manager._id,
    departmentId,
    type: "REPORT_SUBMITTED",
    title: "Review",
    message: `${name} notification`,
    reportId: report._id,
  });
  return { department, manager, lead, developer, otherDeveloper, project, report, task, notification };
}

export type DepartmentFixture = Awaited<ReturnType<typeof makeDepartment>>;

export async function makeCompany() {
  const ceo = await makeUser("CEO", null, null);
  const it = await makeDepartment("IT", ceo._id);
  const hr = await makeDepartment("HR", ceo._id);
  return { ceo, it, hr };
}

export function request(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; origin?: string } = {},
) {
  return new NextRequest(`${BASE_URL}${path}`, {
    method,
    headers: {
      host: "localhost:3000",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

type Handler<P> = (req: NextRequest, segment: { params: Promise<P> }) => Promise<Response>;

export async function call<P = Record<string, never>>(
  handler: Handler<P>,
  req: NextRequest,
  params?: P,
) {
  const response = await handler(req, { params: Promise.resolve((params ?? {}) as P) });
  return { status: response.status, body: await response.json(), response };
}
