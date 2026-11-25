import type { Prisma } from "@prisma/client";
import { subWeeks } from "date-fns";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { SUBMITTED_STATUSES, type PaletteColor, type ProjectStatus } from "@/lib/constants";
import { isUniqueViolation, prisma } from "@/lib/db/prisma";
import { sendEmailSafely } from "@/lib/email";
import { departmentAssignedEmail, welcomeEmail } from "@/lib/email/templates";
import { createNotification, receivesEmail } from "@/lib/notifications";
import type { Actor } from "@/lib/permissions";
import { isoWeekOf, toUtcDay } from "@/lib/reports/iso-week";
import { avatarColorFor, resolvePlacement } from "@/lib/users/service";
import type {
  CreateDepartmentInput,
  ManagerAssignment,
  UpdateDepartmentInput,
} from "@/validators/department";

type Tx = Prisma.TransactionClient;

const MANAGER_SELECT = { id: true, name: true, email: true, avatarColor: true, role: true } as const;

/**
 * The IT department has no Manager. A Super Admin leads it: its Team Leads report to them, and
 * they give its reports the final approval. It's recognised by who leads it, not by its name.
 */
export const DEFAULT_IT_DEPARTMENT = { name: "IT Department", code: "IT", color: "indigo" } as const;

const LED_BY_SUPER_ADMIN = "This department is led by the Super Admin and has no Manager.";

/**
 * Makes sure there is an IT department, led by this Super Admin. Does nothing once any department
 * is led by a Super Admin, or when the name or code is already taken. Safe to call on every
 * sign-in.
 */
export async function ensureItDepartment(
  superAdmin: { id: string; role: string },
  name: string = DEFAULT_IT_DEPARTMENT.name,
) {
  if (superAdmin.role !== "SUPER_ADMIN") return null;
  const existing = await prisma.department.findFirst({ where: { manager: { role: "SUPER_ADMIN" } } });
  if (existing) return existing;
  const taken = await prisma.department.findFirst({
    where: { OR: [{ name: { equals: name, mode: "insensitive" } }, { code: DEFAULT_IT_DEPARTMENT.code }] },
    select: { id: true },
  });
  if (taken) return null;
  try {
    const department = await prisma.department.create({
      data: {
        name,
        code: DEFAULT_IT_DEPARTMENT.code,
        color: DEFAULT_IT_DEPARTMENT.color,
        managerId: superAdmin.id,
        createdBy: superAdmin.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: superAdmin.id,
        action: "department.create",
        targetType: "Department",
        targetId: department.id,
        meta: { managerId: superAdmin.id, default: true },
      },
    });
    return department;
  } catch (error) {
    // Two sign-ins at once: the other one created it.
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

async function assertNameAndCodeFree(input: { name?: string; code?: string }, exceptId?: string) {
  const clauses: Prisma.DepartmentWhereInput[] = [];
  if (input.name) clauses.push({ name: { equals: input.name, mode: "insensitive" } });
  if (input.code) clauses.push({ code: input.code.toUpperCase() });
  if (clauses.length === 0) return;
  const clash = await prisma.department.findFirst({
    where: { OR: clauses, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw conflict("A department with this name or code already exists.");
}

/**
 * Gets the user who will manage a department. Never trusts the client's choice: an existing user
 * must be an active, approved manager with no department. A new user is created unassigned, and
 * told by email to sign in with their Microsoft account.
 */
async function prepareManager(assignment: ManagerAssignment) {
  if (assignment.mode === "existing") {
    const manager = await prisma.user.findFirst({
      where: { id: assignment.userId, role: "MANAGER", departmentId: null, isActive: true, approval: "APPROVED" },
    });
    if (!manager) throw badRequest("Pick an active Manager who has no department yet.");
    return { manager, isNew: false };
  }
  if (await prisma.user.findUnique({ where: { email: assignment.email }, select: { id: true } })) {
    throw conflict("A user with this email already exists.", "EMAIL_TAKEN");
  }
  const placement = await resolvePlacement({ role: "MANAGER" });
  const manager = await prisma.user.create({
    data: {
      name: assignment.name,
      email: assignment.email,
      role: "MANAGER",
      ...placement,
      avatarColor: avatarColorFor(assignment.email),
    },
  });
  return { manager, isNew: true };
}

/** Atomically claims the manager. Fails if another request assigned them in the meantime. */
async function claimManager(tx: Tx, managerId: string, departmentId: string) {
  const { count } = await tx.user.updateMany({
    where: { id: managerId, role: "MANAGER", departmentId: null },
    data: { departmentId },
  });
  if (count === 0) throw conflict("That Manager was just assigned to another department.");
}

async function notifyAssignedManager(
  manager: { id: string; name: string; email: string; role: string; emailNotifications: boolean },
  department: { id: string; name: string },
  isNew: boolean,
) {
  await createNotification({
    recipientId: manager.id,
    departmentId: department.id,
    type: "DEPARTMENT_ASSIGNED",
    title: `You now manage ${department.name}`,
    message: `You've been assigned as manager of ${department.name}.`,
    link: "/dashboard",
  });
  if (isNew) {
    await sendEmailSafely(welcomeEmail({ to: manager.email, name: manager.name, departmentName: department.name }));
  } else if (receivesEmail(manager)) {
    await sendEmailSafely(
      departmentAssignedEmail({ to: manager.email, name: manager.name, departmentName: department.name }),
    );
  }
}

const audit = (actor: Actor, action: string, targetId: string, meta: Prisma.InputJsonObject) =>
  prisma.auditLog.create({ data: { actorId: actor.id, action, targetType: "Department", targetId, meta } });

export async function createDepartment(actor: Actor, input: CreateDepartmentInput) {
  await assertNameAndCodeFree(input);
  const { manager, isNew } = await prepareManager(input.manager);

  let department;
  try {
    department = await prisma.$transaction(async (tx) => {
      const created = await tx.department.create({
        data: {
          name: input.name,
          code: input.code,
          description: input.description,
          color: input.color,
          managerId: manager.id,
          createdBy: actor.id,
        },
      });
      await claimManager(tx, manager.id, created.id);
      return created;
    });
  } catch (error) {
    // The department rolled back with its transaction. A manager created for it goes too.
    if (isNew) await prisma.user.delete({ where: { id: manager.id } });
    throw error;
  }

  await audit(actor, "department.create", department.id, { managerId: manager.id });
  await notifyAssignedManager(manager, department, isNew);
  return department;
}

export async function updateDepartment(actor: Actor, id: string, patch: UpdateDepartmentInput) {
  await assertNameAndCodeFree(patch, id);
  if (!(await prisma.department.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
  const department = await prisma.department.update({ where: { id }, data: patch });
  await audit(actor, "department.update", id, { changes: Object.keys(patch) });
  return department;
}

/**
 * Hands a department to a new manager: their team leads and open reviews move with it, and the
 * previous manager becomes unassigned and available for another department.
 */
export async function changeDepartmentManager(actor: Actor, id: string, assignment: ManagerAssignment) {
  const department = await prisma.department.findUnique({
    where: { id },
    include: { manager: { select: { role: true } } },
  });
  if (!department) throw notFound();
  if (department.manager?.role === "SUPER_ADMIN") throw badRequest(LED_BY_SUPER_ADMIN, "LED_BY_SUPER_ADMIN");
  if (department.status !== "Active") throw badRequest("Restore this department first.");

  const { manager, isNew } = await prepareManager(assignment);
  const previousManagerId = department.managerId;

  try {
    await prisma.$transaction(async (tx) => {
      await claimManager(tx, manager.id, id);
      await tx.department.update({ where: { id }, data: { managerId: manager.id } });
      if (!previousManagerId) return;
      await tx.user.update({ where: { id: previousManagerId }, data: { departmentId: null } });
      await tx.user.updateMany({
        where: { departmentId: id, reportsTo: previousManagerId },
        data: { reportsTo: manager.id },
      });
      await tx.weeklyReport.updateMany({
        where: { departmentId: id, currentApproverId: previousManagerId },
        data: { currentApproverId: manager.id },
      });
      await tx.projectMember.deleteMany({ where: { userId: previousManagerId, project: { departmentId: id } } });
      // The Bitbucket token was the previous manager's own, so it leaves with them.
      await tx.bitbucketConnection.deleteMany({ where: { departmentId: id } });
    });
  } catch (error) {
    if (isNew) await prisma.user.delete({ where: { id: manager.id } });
    throw error;
  }

  if (previousManagerId) {
    await createNotification({
      recipientId: previousManagerId,
      departmentId: null,
      type: "DEPARTMENT_UNASSIGNED",
      title: `You no longer manage ${department.name}`,
      message: `A new manager has been assigned to ${department.name}.`,
      link: "/dashboard",
    });
  }

  await audit(actor, "department.change_manager", id, { previousManagerId, managerId: manager.id });
  await notifyAssignedManager(manager, department, isNew);
  return { ...department, managerId: manager.id };
}

export async function setDepartmentArchived(actor: Actor, id: string, archived: boolean) {
  if (!(await prisma.department.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
  const department = await prisma.department.update({
    where: { id },
    data: { status: archived ? "Archived" : "Active" },
  });
  await audit(actor, archived ? "department.archive" : "department.restore", id, {});
  return department;
}

async function departmentHasData(department: { id: string; managerId: string | null }) {
  const where = { departmentId: department.id };
  const [people, projects, tasks, reports] = await Promise.all([
    prisma.user.count({ where: { ...where, ...(department.managerId ? { id: { not: department.managerId } } : {}) } }),
    prisma.project.count({ where }),
    prisma.task.count({ where }),
    prisma.weeklyReport.count({ where }),
  ]);
  return people + projects + tasks + reports > 0;
}

/** Only an empty department can be deleted. One with data must be archived instead. */
export async function deleteDepartment(actor: Actor, id: string) {
  const department = await prisma.department.findUnique({ where: { id } });
  if (!department) throw notFound();
  if (await departmentHasData(department)) {
    throw conflict("This department has data. Archive it instead.", "DEPARTMENT_HAS_DATA");
  }
  // Its manager becomes unassigned: the foreign key sets their departmentId to null.
  await prisma.department.delete({ where: { id } });
  await audit(actor, "department.delete", id, { name: department.name, code: department.code });
}

type DepartmentRecord = Prisma.DepartmentGetPayload<{ include: { manager: { select: typeof MANAGER_SELECT } } }>;

function serialise(department: DepartmentRecord) {
  return {
    id: department.id,
    name: department.name,
    code: department.code,
    description: department.description,
    color: department.color as PaletteColor,
    status: department.status,
    /** True for the IT department: a Super Admin leads it, and it has no Manager. */
    ledBySuperAdmin: department.manager?.role === "SUPER_ADMIN",
    manager: department.manager
      ? {
          id: department.manager.id,
          name: department.manager.name,
          email: department.manager.email,
          avatarColor: department.manager.avatarColor as PaletteColor,
        }
      : null,
  };
}

/** Headcount, active projects and submission rate for many departments, in three aggregations. */
export async function listDepartmentsWithStats(where: Prisma.DepartmentWhereInput, now = new Date()) {
  const departments = await prisma.department.findMany({
    where,
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: { manager: { select: MANAGER_SELECT } },
  });
  const ids = departments.map((department) => department.id);
  const { isoYear, isoWeek } = isoWeekOf(now);
  const inDepartments = { departmentId: { in: ids } };
  const count = { _count: { _all: true } } as const;

  const [headcounts, activeProjects, submitted] = await Promise.all([
    prisma.user.groupBy({ by: ["departmentId"], where: { ...inDepartments, isActive: true }, ...count }),
    prisma.project.groupBy({ by: ["departmentId"], where: { ...inDepartments, status: "Active" }, ...count }),
    prisma.weeklyReport.groupBy({
      by: ["departmentId"],
      where: { ...inDepartments, isoYear, isoWeek, status: { in: [...SUBMITTED_STATUSES] } },
      ...count,
    }),
  ]);

  const byId = (rows: { departmentId: string | null; _count: { _all: number } }[]) =>
    new Map(rows.map((row) => [row.departmentId, row._count._all]));
  const headcountById = byId(headcounts);
  const projectsById = byId(activeProjects);
  const submittedById = byId(submitted);

  return departments.map((department) => {
    const headcount = headcountById.get(department.id) ?? 0;
    const submittedCount = submittedById.get(department.id) ?? 0;
    return {
      ...serialise(department),
      headcount,
      activeProjects: projectsById.get(department.id) ?? 0,
      submittedCount,
      submissionRate: headcount === 0 ? 0 : Math.round((submittedCount / headcount) * 100),
    };
  });
}

export const WEEKS_IN_MINI_DASHBOARD = 6;

/**
 * The CEO's department page. Hours come only from MANAGER_APPROVED reports, because the CEO must
 * see nothing that isn't fully approved. Tasks in other states never enter these numbers.
 */
export async function getDepartmentDetail(id: string, now = new Date()) {
  const [summary] = await listDepartmentsWithStats({ id }, now);
  if (!summary) return null;

  const since = toUtcDay(subWeeks(now, WEEKS_IN_MINI_DASHBOARD));
  const approved: Prisma.WeeklyReportWhereInput = {
    departmentId: id,
    status: "MANAGER_APPROVED",
    weekStart: { gte: since },
  };

  const [people, projects, hoursByWeek, hoursByProject, hasData] = await Promise.all([
    prisma.user.findMany({
      where: { departmentId: id },
      select: { id: true, name: true, email: true, role: true, avatarColor: true, isActive: true, reportsTo: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { departmentId: id },
      select: { id: true, name: true, code: true, color: true, status: true },
      orderBy: { name: "asc" },
    }),
    prisma.weeklyReport.groupBy({
      by: ["weekStart", "isoWeek"],
      where: approved,
      _sum: { totalHours: true },
      orderBy: { weekStart: "asc" },
    }),
    prisma.reportProjectTotal.groupBy({
      by: ["projectId"],
      where: { report: approved },
      _sum: { hours: true },
      orderBy: { _sum: { hours: "desc" } },
    }),
    departmentHasData({ id, managerId: summary.manager?.id ?? null }),
  ]);

  const serialisePerson = (person: (typeof people)[number]) => ({
    id: person.id,
    name: person.name,
    email: person.email,
    avatarColor: person.avatarColor as PaletteColor,
    isActive: person.isActive,
    reportsTo: person.reportsTo,
  });
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const byWeek = hoursByWeek.map((week) => ({ label: `W${week.isoWeek}`, hours: week._sum.totalHours ?? 0 }));

  return {
    ...summary,
    canDelete: !hasData,
    teamLeads: people.filter((person) => person.role === "TEAM_LEAD").map(serialisePerson),
    developers: people.filter((person) => person.role === "DEVELOPER").map(serialisePerson),
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      code: project.code,
      color: project.color as PaletteColor,
      status: project.status as ProjectStatus,
    })),
    approved: {
      totalHours: byWeek.reduce((sum, week) => sum + week.hours, 0),
      byWeek,
      byProject: hoursByProject.flatMap((row) => {
        const project = projectById.get(row.projectId);
        return project
          ? [{ name: project.name, color: project.color as PaletteColor, hours: row._sum.hours ?? 0 }]
          : [];
      }),
    },
  };
}

export type DepartmentSummary = Awaited<ReturnType<typeof listDepartmentsWithStats>>[number];
export type DepartmentDetail = NonNullable<Awaited<ReturnType<typeof getDepartmentDetail>>>;
