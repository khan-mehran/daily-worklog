import { config } from "dotenv";
import { addDays, subWeeks } from "date-fns";
import mongoose, { Types } from "mongoose";
import { hashPassword } from "../src/lib/auth/password";
import { PALETTE, type ReportStatus, type Role, type TaskStatus } from "../src/lib/constants";
import { connectDB, disconnectDB } from "../src/lib/db/connect";
import { isoWeekOf, toUtcDay } from "../src/lib/reports/iso-week";
import {
  AuditLog,
  Department,
  Notification,
  Project,
  RateLimit,
  Task,
  User,
  WeeklyReport,
  type IProject,
  type ITrailEntry,
} from "../src/models";
import { SEED_CEO, SEED_DEPARTMENTS, type SeedDepartment } from "./seed-data";

config({ path: ".env.local" });
config({ path: ".env" });

const DEMO_PASSWORD = "WorkLog!2026";
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
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: Role;
  reportsTo: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
  avatarColor: (typeof PALETTE)[number];
  isActive: boolean;
  passwordHash: string;
}

const code = (department: SeedDepartment) => department.code.toLowerCase();
let avatarIndex = 0;

function makeUser(
  name: string,
  email: string,
  role: Role,
  departmentId: Types.ObjectId | null,
  reportsTo: Types.ObjectId | null,
  passwordHash: string,
): SeedUser {
  return {
    _id: new Types.ObjectId(),
    name,
    email,
    role,
    departmentId,
    reportsTo,
    passwordHash,
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
function workflowFor(
  owner: SeedUser,
  status: ReportStatus,
  usersById: Map<string, SeedUser>,
  weekEnd: Date,
) {
  const approver = owner.reportsTo ? usersById.get(String(owner.reportsTo))! : null;
  const secondApprover = approver?.reportsTo ? usersById.get(String(approver.reportsTo))! : null;
  // Steps in the current week would land after now, so they are pulled back into the past,
  // keeping their order: a later step (higher `day`) stays later.
  const at = (day: number, hour: number) => {
    const planned = addDays(weekEnd, day).getTime() + hour * 3600_000;
    return new Date(Math.min(planned, Date.now() - (5 - day) * 3600_000));
  };

  const trail: ITrailEntry[] = [];
  const fields: {
    currentApproverId: Types.ObjectId | null;
    submittedAt: Date | null;
    leadApprovedAt: Date | null;
    managerApprovedAt: Date | null;
  } = { currentApproverId: null, submittedAt: null, leadApprovedAt: null, managerApprovedAt: null };

  if (status === "DRAFT") return { ...fields, approvalTrail: trail };

  fields.submittedAt = at(-2, 13);
  trail.push({ action: "SUBMITTED", byUserId: owner._id, at: fields.submittedAt, comment: null });

  if (status === "SUBMITTED") {
    fields.currentApproverId = approver!._id;
    return { ...fields, approvalTrail: trail };
  }
  if (status === "CHANGES_REQUESTED") {
    trail.push({
      action: "CHANGES_REQUESTED",
      byUserId: approver!._id,
      at: at(1, 10),
      comment: pick(LEAD_COMMENTS),
    });
    fields.submittedAt = null;
    return { ...fields, approvalTrail: trail };
  }
  if (owner.role === "DEVELOPER") {
    fields.leadApprovedAt = at(1, 10);
    trail.push({
      action: "LEAD_APPROVED",
      byUserId: approver!._id,
      at: fields.leadApprovedAt,
      comment: null,
    });
    if (status === "LEAD_APPROVED") {
      fields.currentApproverId = secondApprover!._id;
      return { ...fields, approvalTrail: trail };
    }
    fields.managerApprovedAt = at(2, 15);
    trail.push({
      action: "MANAGER_APPROVED",
      byUserId: secondApprover!._id,
      at: fields.managerApprovedAt,
      comment: null,
    });
    return { ...fields, approvalTrail: trail };
  }
  // A Team Lead's or Manager's report has a single approver, who gives final approval.
  fields.managerApprovedAt = at(1, 15);
  trail.push({
    action: owner.role === "MANAGER" ? "CEO_ACKNOWLEDGED" : "MANAGER_APPROVED",
    byUserId: approver!._id,
    at: fields.managerApprovedAt,
    comment: null,
  });
  return { ...fields, approvalTrail: trail };
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed: this script erases the database.");
  }
  await connectDB();
  const db = mongoose.connection.db!;
  console.log(`Seeding ${db.databaseName} ...`);
  await db.dropDatabase();
  await Promise.all(
    [AuditLog, Department, Notification, Project, RateLimit, Task, User, WeeklyReport].map(
      (model) => model.createIndexes(),
    ),
  );

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = new Date();
  const ceo = makeUser(SEED_CEO, "ceo@worklog.demo", "CEO", null, null, passwordHash);
  const users: SeedUser[] = [ceo];
  const departmentDocs = [];
  const projectDocs: (Omit<IProject, "createdAt" | "updatedAt">)[] = [];

  for (const seed of SEED_DEPARTMENTS) {
    const departmentId = new Types.ObjectId();
    const manager = makeUser(
      seed.manager,
      `manager.${code(seed)}@worklog.demo`,
      "MANAGER",
      departmentId,
      ceo._id,
      passwordHash,
    );
    users.push(manager);
    const members: SeedUser[] = [];
    let developerNumber = 1;
    seed.teams.forEach((team, index) => {
      const lead = makeUser(
        team.lead,
        `lead${index + 1}.${code(seed)}@worklog.demo`,
        "TEAM_LEAD",
        departmentId,
        manager._id,
        passwordHash,
      );
      members.push(lead);
      for (const name of team.developers) {
        members.push(
          makeUser(
            name,
            `dev${developerNumber++}.${code(seed)}@worklog.demo`,
            "DEVELOPER",
            departmentId,
            lead._id,
            passwordHash,
          ),
        );
      }
    });
    users.push(...members);

    departmentDocs.push({
      _id: departmentId,
      name: seed.name,
      code: seed.code,
      description: seed.description,
      color: seed.color,
      managerId: manager._id,
      status: "Active",
      createdBy: ceo._id,
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
      projectDocs.push({
        _id: new Types.ObjectId(),
        departmentId,
        name: project.name,
        code: project.code,
        description: project.description,
        color: project.color,
        status: "Active",
        startDate: toUtcDay(subWeeks(now, 12)),
        endDate: null,
        ownerId: manager._id,
        memberIds: [manager._id, ...assigned.map((member) => member._id)],
        createdBy: manager._id,
      });
    });
  }

  await User.insertMany(users);
  await Department.insertMany(departmentDocs);
  await Project.insertMany(projectDocs);

  const usersById = new Map(users.map((user) => [String(user._id), user]));
  const taskTextByProjectId = new Map<string, string[]>();
  for (const [index, project] of projectDocs.entries()) {
    const seedProject = SEED_DEPARTMENTS.flatMap((department) => department.projects)[index]!;
    taskTextByProjectId.set(String(project._id), seedProject.tasks);
  }

  const reports = [];
  const tasks = [];
  const today = toUtcDay(now);

  for (const owner of users) {
    if (!owner.departmentId) continue;
    const ownProjects = projectDocs.filter(
      (project) =>
        String(project.departmentId) === String(owner.departmentId) &&
        project.memberIds.some((id) => String(id) === String(owner._id)),
    );

    for (let weeksAgo = WEEKS - 1; weeksAgo >= 0; weeksAgo--) {
      const week = isoWeekOf(subWeeks(now, weeksAgo));
      // Each department's first developer always has an open week, so the demo has one to submit.
      const status =
        weeksAgo === 0 && owner.email.startsWith("dev1.") ? "DRAFT" : statusForWeek(weeksAgo, owner.role);
      const reportId = new Types.ObjectId();
      const byProject = new Map<string, { hours: number; taskCount: number }>();
      let hoursTotal = 0;
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
          const text = pick(taskTextByProjectId.get(String(project._id))!);
          const hours = index === dayTasks - 1 ? hoursLeft : 1 + Math.floor(random() * (hoursLeft - 1));
          hoursLeft -= hours;
          // The "Waiting on" entries in the seed text are written as blockers.
          const taskStatus: TaskStatus = text.startsWith("Waiting")
            ? "Blocked"
            : weeksAgo === 0 && random() < 0.3
              ? "In Progress"
              : "Completed";
          tasks.push({
            userId: owner._id,
            departmentId: owner.departmentId,
            projectId: project._id,
            date,
            details: text,
            hours,
            status: taskStatus,
            weeklyReportId: reportId,
            reportStatus: status,
          });
          hoursTotal += hours;
          taskCount += 1;
          if (taskStatus === "Completed") completedCount += 1;
          if (taskStatus === "Blocked") blockedCount += 1;
          const row = byProject.get(String(project._id)) ?? { hours: 0, taskCount: 0 };
          row.hours += hours;
          row.taskCount += 1;
          byProject.set(String(project._id), row);
        }
      }

      reports.push({
        _id: reportId,
        userId: owner._id,
        departmentId: owner.departmentId,
        ...week,
        status,
        ...workflowFor(owner, status, usersById, week.weekEnd),
        totals: {
          hours: hoursTotal,
          taskCount,
          completedCount,
          blockedCount,
          byProject: [...byProject].map(([projectId, row]) => ({
            projectId: new Types.ObjectId(projectId),
            ...row,
          })),
        },
      });
    }
  }

  await WeeklyReport.insertMany(reports);
  await Task.insertMany(tasks);

  const notifications = reports.flatMap((report) => {
    if (!report.currentApproverId) return [];
    const owner = usersById.get(String(report.userId))!;
    return [
      {
        recipientId: report.currentApproverId,
        departmentId: report.departmentId,
        type: "REPORT_SUBMITTED",
        title: "Report waiting for your review",
        message: `${owner.name}'s report for week ${report.isoWeek} is ready for review.`,
        link: `/reports/${report._id}`,
        reportId: report._id,
      },
    ];
  });
  await Notification.insertMany(notifications);

  const counts = reports.reduce<Record<string, number>>((all, report) => {
    all[report.status] = (all[report.status] ?? 0) + 1;
    return all;
  }, {});
  console.log(
    `Created ${users.length} users, ${departmentDocs.length} departments, ${projectDocs.length} projects, ` +
      `${tasks.length} tasks, ${reports.length} reports, ${notifications.length} notifications.`,
  );
  console.log("Report states:", counts);
  console.log(`\nSign in with any of these. The password for all of them is ${DEMO_PASSWORD}`);
  for (const email of [
    "ceo@worklog.demo",
    "manager.it@worklog.demo",
    "lead1.it@worklog.demo",
    "dev1.it@worklog.demo",
    "manager.hr@worklog.demo",
  ]) {
    console.log(`  ${email}`);
  }
  await disconnectDB();
}

main().catch(async (error) => {
  console.error(error);
  await disconnectDB();
  process.exit(1);
});
