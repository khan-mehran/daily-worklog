import { subWeeks } from "date-fns";
import { NextRequest } from "next/server";
import { vi } from "vitest";
import { auth } from "@/lib/auth";
import type { Role } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { isoWeekOf } from "@/lib/reports/iso-week";
import { truncateAll } from "../scripts/reset-db";

/**
 * The fixture's approved report sits four weeks back: inside the six-week dashboards, and clear
 * of the current and previous weeks, where tests log new work.
 */
export const FIXTURE_WEEK = isoWeekOf(subWeeks(new Date(), 4));

export const BASE_URL = "http://localhost:3000";

export async function resetDatabase() {
  const [current] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (!current?.name.endsWith("_test")) {
    throw new Error(`Refusing to empty "${current?.name}": tests only run against a *_test database.`);
  }
  await truncateAll(prisma);
}

export function signInAs(user: { id: string } | null) {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(
    user ? { user: { id: user.id } } : null,
  );
}

let emailCounter = 0;

export async function makeUser(
  role: Role,
  departmentId: string | null,
  reportsTo: string | null,
  name = `${role} ${++emailCounter}`,
) {
  return prisma.user.create({
    data: { name, email: `user${++emailCounter}@test.local`, role, departmentId, reportsTo },
  });
}

/** Someone who has signed in with Microsoft for the first time and is waiting for approval. */
export async function makePendingUser(name = "Waiting Person") {
  return prisma.user.create({
    data: { name, email: `pending${++emailCounter}@test.local`, role: "DEVELOPER", approval: "PENDING" },
  });
}

/** A report's cached totals for work on one project, as `create` data. */
export function reportTotals(
  projectId: string,
  hours: number,
  counts: { taskCount?: number; completedCount?: number; blockedCount?: number } = {},
) {
  const taskCount = counts.taskCount ?? 1;
  return {
    totalHours: hours,
    taskCount,
    completedCount: counts.completedCount ?? taskCount,
    blockedCount: counts.blockedCount ?? 0,
    byProject: { create: [{ projectId, hours, taskCount }] },
  };
}

/** The ids of the people assigned to a project. */
export async function memberIdsOf(projectId: string) {
  const members = await prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } });
  return members.map((member) => member.userId);
}

/** Replaces a project's members. */
export async function setMembers(projectId: string, userIds: string[]) {
  await prisma.projectMember.deleteMany({ where: { projectId } });
  await prisma.projectMember.createMany({ data: userIds.map((userId) => ({ projectId, userId })) });
}

/** One department with the full chain: manager, lead, two developers, a project and records. */
export async function makeDepartment(name: string, ceoId: string) {
  const created = await prisma.department.create({
    data: { name, code: name.toUpperCase().slice(0, 8), color: "teal", createdBy: ceoId },
  });
  const departmentId = created.id;
  const manager = await makeUser("MANAGER", departmentId, ceoId);
  const lead = await makeUser("TEAM_LEAD", departmentId, manager.id);
  const developer = await makeUser("DEVELOPER", departmentId, lead.id);
  const otherDeveloper = await makeUser("DEVELOPER", departmentId, lead.id);
  const department = await prisma.department.update({
    where: { id: departmentId },
    data: { managerId: manager.id },
  });
  const project = await prisma.project.create({
    data: {
      departmentId,
      name: `${name} project`,
      code: "PRJ",
      color: "teal",
      ownerId: manager.id,
      createdBy: manager.id,
      members: { create: [{ userId: developer.id }, { userId: lead.id }] },
    },
  });
  const report = await prisma.weeklyReport.create({
    data: {
      userId: developer.id,
      departmentId,
      ...FIXTURE_WEEK,
      status: "MANAGER_APPROVED",
      ...reportTotals(project.id, 8),
    },
  });
  const task = await prisma.task.create({
    data: {
      userId: developer.id,
      departmentId,
      projectId: project.id,
      date: FIXTURE_WEEK.weekStart,
      details: `${name} secret task`,
      hours: 8,
      status: "Completed",
      weeklyReportId: report.id,
      reportStatus: "MANAGER_APPROVED",
    },
  });
  const notification = await prisma.notification.create({
    data: {
      recipientId: manager.id,
      departmentId,
      type: "REPORT_SUBMITTED",
      title: "Review",
      message: `${name} notification`,
      reportId: report.id,
    },
  });
  return { department, manager, lead, developer, otherDeveloper, project, report, task, notification };
}

export type DepartmentFixture = Awaited<ReturnType<typeof makeDepartment>>;

export async function makeCompany() {
  const ceo = await makeUser("CEO", null, null);
  const it = await makeDepartment("IT", ceo.id);
  const hr = await makeDepartment("HR", ceo.id);
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
