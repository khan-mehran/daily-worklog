import { randomUUID } from "node:crypto";
import type { Prisma, TrailAction } from "@prisma/client";
import { config } from "dotenv";
import { addDays, subWeeks } from "date-fns";
import { PALETTE, type ReportStatus, type Role, type TaskStatus } from "../src/lib/constants";
import { isoWeekOf, toUtcDay } from "../src/lib/reports/iso-week";
import { truncateAll } from "./reset-db";
import { SEED_CEO, SEED_DEPARTMENTS, type SeedDepartment } from "./seed-data";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const WEEKS = 6;

/** Deterministic, so every seed produces the same demo. */
function createRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const random = createRandom(44);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

interface SeedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  reportsTo: string | null;
  departmentId: string | null;
  avatarColor: (typeof PALETTE)[number];
  isActive: boolean;
}

interface SeedProject {
  id: string;
  departmentId: string;
  name: string;
  code: string;
  description: string;
  color: string;
  status: string;
  startDate: Date;
  ownerId: string;
  createdBy: string;
  memberIds: string[];
}

interface TrailEntry {
  action: TrailAction;
  byUserId: string;
  at: Date;
  comment: string | null;
}

const code = (department: SeedDepartment) => department.code.toLowerCase();
let avatarIndex = 0;

function makeUser(
  name: string,
  email: string,
  role: Role,
  departmentId: string | null,
  reportsTo: string | null,
): SeedUser {
  return {
    id: randomUUID(),
    name,
    email,
    role,
    departmentId,
    reportsTo,
    avatarColor: PALETTE[avatarIndex++ % PALETTE.length]!,
    isActive: true,
  };
}

/** Status of one report, by how many weeks ago it was. Older weeks are further along the chain. */
function statusForWeek(weeksAgo: number, role: Role): ReportStatus {
  const roll = random();
  if (weeksAgo >= 3) return roll < 0.94 ? "MANAGER_APPROVED" : "LEAD_APPROVED";
  if (weeksAgo === 2) {
    if (roll < 0.7) return "MANAGER_APPROVED";
    return role === "DEVELOPER" ? "LEAD_APPROVED" : "SUBMITTED";
  }
  if (weeksAgo === 1) {
    if (roll < 0.25) return "MANAGER_APPROVED";
    if (roll < 0.5 && role === "DEVELOPER") return "LEAD_APPROVED";
    if (roll < 0.8) return "SUBMITTED";
    return "CHANGES_REQUESTED";
  }
  return roll < 0.75 ? "DRAFT" : "SUBMITTED";
}

const LEAD_COMMENTS = [
  "Please add the hours for Wednesday and say what is blocking the second task.",
  "The Tuesday entry is too vague. Could you add which part you finished?",
  "Friday's tasks look like they belong to a different project. Please check.",
];

/**
 * Builds a report's workflow fields by replaying the approval chain, so seeded reports are in
 * exactly the states the real workflow produces.
 */
function workflowFor(owner: SeedUser, status: ReportStatus, usersById: Map<string, SeedUser>, weekEnd: Date) {
  const approver = owner.reportsTo ? usersById.get(owner.reportsTo)! : null;
  const secondApprover = approver?.reportsTo ? usersById.get(approver.reportsTo)! : null;
  // Steps in the current week would land after now, so they are pulled back into the past,
  // keeping their order: a later step (higher `day`) stays later.
  const at = (day: number, hour: number) => {
    const planned = addDays(weekEnd, day).getTime() + hour * 3600_000;
    return new Date(Math.min(planned, Date.now() - (5 - day) * 3600_000));
  };

  const trail: TrailEntry[] = [];
  const fields: {
    currentApproverId: string | null;
    submittedAt: Date | null;
    leadApprovedAt: Date | null;
    managerApprovedAt: Date | null;
  } = { currentApproverId: null, submittedAt: null, leadApprovedAt: null, managerApprovedAt: null };

  if (status === "DRAFT") return { fields, trail };

  fields.submittedAt = at(-2, 13);
  trail.push({ action: "SUBMITTED", byUserId: owner.id, at: fields.submittedAt, comment: null });

  if (status === "SUBMITTED") {
    fields.currentApproverId = approver!.id;
    return { fields, trail };
  }
  if (status === "CHANGES_REQUESTED") {
    trail.push({ action: "CHANGES_REQUESTED", byUserId: approver!.id, at: at(1, 10), comment: pick(LEAD_COMMENTS) });
    fields.submittedAt = null;
    return { fields, trail };
  }
  if (owner.role === "DEVELOPER") {
    fields.leadApprovedAt = at(1, 10);
    trail.push({ action: "LEAD_APPROVED", byUserId: approver!.id, at: fields.leadApprovedAt, comment: null });
    if (status === "LEAD_APPROVED") {
      fields.currentApproverId = secondApprover!.id;
      return { fields, trail };
    }
    fields.managerApprovedAt = at(2, 15);
    trail.push({
      action: "MANAGER_APPROVED",
      byUserId: secondApprover!.id,
      at: fields.managerApprovedAt,
      comment: null,
    });
    return { fields, trail };
  }
  // A Team Lead's or Manager's report has a single approver, who gives final approval.
  fields.managerApprovedAt = at(1, 15);
  trail.push({
    action: owner.role === "MANAGER" ? "CEO_ACKNOWLEDGED" : "MANAGER_APPROVED",
    byUserId: approver!.id,
    at: fields.managerApprovedAt,
    comment: null,
  });
  return { fields, trail };
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed: this script erases the database.");
  }
  // Imported here, after the env files are loaded, because the client reads DATABASE_URL.
  const { prisma } = await import("../src/lib/db/prisma");
  const [current] = await prisma.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
  console.log(`Seeding ${current?.database} ...`);
  await truncateAll(prisma);

  const now = new Date();
  const admin = makeUser("Sam Okafor", "admin@getl.demo", "SUPER_ADMIN", null, null);
  const ceo = makeUser(SEED_CEO, "ceo@getl.demo", "CEO", null, null);
  const users: SeedUser[] = [admin, ceo];
  const departments: (Prisma.DepartmentCreateManyInput & { id: string; managerId: string })[] = [];
  const projects: SeedProject[] = [];

  for (const seed of SEED_DEPARTMENTS) {
    const departmentId = randomUUID();
    const manager = makeUser(
      seed.manager,
      `manager.${code(seed)}@getl.demo`,
      "MANAGER",
      departmentId,
      ceo.id,
    );
    users.push(manager);
    const members: SeedUser[] = [];
    let developerNumber = 1;
    seed.teams.forEach((team, index) => {
      const lead = makeUser(
        team.lead,
        `lead${index + 1}.${code(seed)}@getl.demo`,
        "TEAM_LEAD",
        departmentId,
        manager.id,
      );
      members.push(lead);
      for (const name of team.developers) {
        members.push(
          makeUser(
            name,
            `dev${developerNumber++}.${code(seed)}@getl.demo`,
            "DEVELOPER",
            departmentId,
            lead.id,
          ),
        );
      }
    });
    users.push(...members);

    departments.push({
      id: departmentId,
      name: seed.name,
      code: seed.code,
      description: seed.description,
      color: seed.color,
      managerId: manager.id,
      status: "Active",
      createdBy: ceo.id,
    });

    seed.projects.forEach((project, index) => {
      // Leads join every project. Each developer is left out of at least one, so the demo always
      // has a project a developer can't see.
      const projectCount = seed.projects.length;
      const assigned = members.filter((member, memberIndex) => {
        if (member.role === "TEAM_LEAD") return true;
        const slot = (memberIndex + index) % projectCount;
        return projectCount === 2 ? slot === 0 : slot !== 0;
      });
      projects.push({
        id: randomUUID(),
        departmentId,
        name: project.name,
        code: project.code,
        description: project.description,
        color: project.color,
        status: "Active",
        startDate: toUtcDay(subWeeks(now, 12)),
        ownerId: manager.id,
        createdBy: manager.id,
        memberIds: [manager.id, ...assigned.map((member) => member.id)],
      });
    });
  }

  // Users and departments point at each other, so they go in three steps: people without a
  // department or approver, then departments, then the links between them.
  // Demo people count as having seen the one-time VS Code sync popup, so it doesn't cover the demo.
  await prisma.user.createMany({
    data: users.map((user) => ({ ...user, departmentId: null, reportsTo: null, syncGuideSeenAt: new Date() })),
  });
  await prisma.department.createMany({ data: departments });
  for (const user of users) {
    if (!user.departmentId && !user.reportsTo) continue;
    await prisma.user.update({
      where: { id: user.id },
      data: { departmentId: user.departmentId, reportsTo: user.reportsTo },
    });
  }
  // Someone who has signed in with Microsoft and is still waiting, so the Users page has a
  // request to approve.
  await prisma.user.create({
    data: { name: "Nadia Haddad", email: "newcomer@getl.demo", role: "DEVELOPER", approval: "PENDING", avatarColor: "sky" },
  });
  await prisma.project.createMany({
    data: projects.map((project) => ({ ...project, memberIds: undefined })),
  });
  await prisma.projectMember.createMany({
    data: projects.flatMap((project) => project.memberIds.map((userId) => ({ projectId: project.id, userId }))),
  });

  const usersById = new Map(users.map((user) => [user.id, user]));
  const taskTextByProjectId = new Map<string, string[]>();
  for (const [index, project] of projects.entries()) {
    const seedProject = SEED_DEPARTMENTS.flatMap((department) => department.projects)[index]!;
    taskTextByProjectId.set(project.id, seedProject.tasks);
  }

  const reports: Prisma.WeeklyReportCreateManyInput[] = [];
  const projectTotals: Prisma.ReportProjectTotalCreateManyInput[] = [];
  const trailEntries: Prisma.ReportTrailEntryCreateManyInput[] = [];
  const tasks: Prisma.TaskCreateManyInput[] = [];
  const today = toUtcDay(now);

  for (const owner of users) {
    if (!owner.departmentId) continue;
    const ownProjects = projects.filter(
      (project) => project.departmentId === owner.departmentId && project.memberIds.includes(owner.id),
    );

    for (let weeksAgo = WEEKS - 1; weeksAgo >= 0; weeksAgo--) {
      const week = isoWeekOf(subWeeks(now, weeksAgo));
      // Each department's first developer always has an open week, so the demo has one to submit.
      const status =
        weeksAgo === 0 && owner.email.startsWith("dev1.") ? "DRAFT" : statusForWeek(weeksAgo, owner.role);
      const reportId = randomUUID();
      const byProject = new Map<string, { hours: number; taskCount: number }>();
      let totalHours = 0;
      let taskCount = 0;
      let completedCount = 0;
      let blockedCount = 0;

      for (let weekday = 0; weekday < 5; weekday++) {
        const date = addDays(week.weekStart, weekday);
        if (date > today) continue;
        const dayTasks = random() < 0.35 ? 1 : 2;
        let hoursLeft = 6 + Math.floor(random() * 3);
        for (let index = 0; index < dayTasks; index++) {
          const project = pick(ownProjects);
          const text = pick(taskTextByProjectId.get(project.id)!);
          const hours = index === dayTasks - 1 ? hoursLeft : 1 + Math.floor(random() * (hoursLeft - 1));
          hoursLeft -= hours;
          // The "Waiting on" entries in the seed text are written as blockers.
          const taskStatus: TaskStatus = text.startsWith("Waiting")
            ? "Blocked"
            : weeksAgo === 0 && random() < 0.3
              ? "In Progress"
              : "Completed";
          tasks.push({
            userId: owner.id,
            departmentId: owner.departmentId,
            projectId: project.id,
            date,
            details: text,
            hours,
            status: taskStatus,
            weeklyReportId: reportId,
            reportStatus: status,
          });
          totalHours += hours;
          taskCount += 1;
          if (taskStatus === "Completed") completedCount += 1;
          if (taskStatus === "Blocked") blockedCount += 1;
          const row = byProject.get(project.id) ?? { hours: 0, taskCount: 0 };
          row.hours += hours;
          row.taskCount += 1;
          byProject.set(project.id, row);
        }
      }

      const workflow = workflowFor(owner, status, usersById, week.weekEnd);
      reports.push({
        id: reportId,
        userId: owner.id,
        departmentId: owner.departmentId,
        ...week,
        status,
        ...workflow.fields,
        totalHours,
        taskCount,
        completedCount,
        blockedCount,
      });
      for (const [projectId, row] of byProject) projectTotals.push({ reportId, projectId, ...row });
      for (const entry of workflow.trail) trailEntries.push({ reportId, ...entry });
    }
  }

  await prisma.weeklyReport.createMany({ data: reports });
  await prisma.reportProjectTotal.createMany({ data: projectTotals });
  await prisma.reportTrailEntry.createMany({ data: trailEntries });
  await prisma.task.createMany({ data: tasks });

  const notifications = reports.flatMap((report) => {
    if (!report.currentApproverId) return [];
    const owner = usersById.get(report.userId)!;
    return [
      {
        recipientId: report.currentApproverId,
        departmentId: report.departmentId,
        type: "REPORT_SUBMITTED" as const,
        title: "Report waiting for your review",
        message: `${owner.name}'s report for week ${report.isoWeek} is ready for review.`,
        link: `/reports/${report.id}`,
        reportId: report.id,
      },
    ];
  });
  await prisma.notification.createMany({ data: notifications });

  const counts = reports.reduce<Record<string, number>>((all, report) => {
    const status = report.status ?? "DRAFT";
    all[status] = (all[status] ?? 0) + 1;
    return all;
  }, {});
  console.log(
    `Created ${users.length} users, ${departments.length} departments, ${projects.length} projects, ` +
      `${tasks.length} tasks, ${reports.length} reports, ${notifications.length} notifications.`,
  );
  console.log("Report states:", counts);
  console.log(
    "\nThese are demo accounts for tests and screenshots. GET List signs people in with Microsoft only,\n" +
      "so nobody can sign in as them outside the browser tests:",
  );
  for (const email of [
    "admin@getl.demo",
    "ceo@getl.demo",
    "manager.it@getl.demo",
    "lead1.it@getl.demo",
    "dev1.it@getl.demo",
    "manager.hr@getl.demo",
  ]) {
    console.log(`  ${email}`);
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
