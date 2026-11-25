import type { Prisma } from "@prisma/client";
import { badRequest, conflict, forbidden, notFound, tooManyRequests } from "@/lib/api/errors";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { listRepositories, type BitbucketRepository } from "@/lib/audit/bitbucket";
import { AuditError } from "@/lib/audit/errors";
import { auditProject, serialiseAudit } from "@/lib/audit/service";
import { bitbucketDepartmentOf, credentialsFor, departmentConnection } from "@/lib/bitbucket/connection";
import { PALETTE, type PaletteColor, type ProjectStatus, type Role, type TaskStatus } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { notify } from "@/lib/notifications";
import { canManageProjects, projectScope, type Actor } from "@/lib/permissions";
import { visibleReportsFilter } from "@/lib/reports/visibility";
import {
  normaliseRepository,
  type CreateProjectInput,
  type ListProjectsQuery,
  type UpdateMembersInput,
  type UpdateProjectInput,
} from "@/validators/project";

const WEEKS_IN_CHART = 8;
const RECENT_TASKS = 10;
const CHECKS_PER_HOUR = 10;
const IMPORTS_PER_HOUR = 10;
/** The most projects one import adds. Whatever is left is offered again. */
const IMPORT_LIMIT = 500;

const toDay = (value: string | null | undefined) => (value ? new Date(`${value}T00:00:00.000Z`) : null);
const fromDay = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

const PROJECT_INCLUDE = {
  members: {
    orderBy: [{ createdAt: "asc" }, { user: { name: "asc" } }],
    select: { user: { select: { id: true, name: true, role: true, avatarColor: true, isActive: true } } },
  },
  department: { select: { id: true, name: true, code: true, color: true } },
} satisfies Prisma.ProjectInclude;

type ProjectRecord = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;

function serialise(project: ProjectRecord) {
  return {
    id: project.id,
    name: project.name,
    code: project.code,
    description: project.description,
    color: project.color as PaletteColor,
    status: project.status as ProjectStatus,
    startDate: fromDay(project.startDate),
    endDate: fromDay(project.endDate),
    repository: project.repository,
    department: {
      id: project.department.id,
      name: project.department.name,
      code: project.department.code,
      color: project.department.color as PaletteColor,
    },
    members: project.members.map(({ user }) => ({
      id: user.id,
      name: user.name,
      role: user.role as Role,
      avatarColor: user.avatarColor as PaletteColor,
      isActive: user.isActive,
    })),
  };
}

export async function listProjects(actor: Actor, selectedDepartmentId: string | null, query: ListProjectsQuery) {
  // projectScope ignores the requested department for everyone but the CEO.
  const where: Prisma.ProjectWhereInput = {
    ...projectScope(actor, query.departmentId ?? selectedDepartmentId),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { code: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: PROJECT_INCLUDE,
    }),
    prisma.project.count({ where }),
  ]);
  return { projects: projects.map(serialise), total };
}

/**
 * Finds a project the actor may see, or throws a 404. Always call this before any role check, so
 * a project outside the actor's visibility is a 404 rather than a 403.
 */
async function requireVisibleProject(actor: Actor, id: string) {
  const project = await prisma.project.findFirst({ where: { id, ...projectScope(actor) } });
  if (!project) throw notFound();
  return project;
}

/**
 * The department whose projects the actor adds and manages: their own for a Manager or Team Lead,
 * and the department they lead for a Super Admin (the IT department, which has no Manager).
 */
export async function projectDepartmentOf(actor: Actor): Promise<string | null> {
  if (canManageProjects(actor)) return actor.departmentId;
  if (actor.role !== "SUPER_ADMIN") return null;
  const led = await prisma.department.findFirst({ where: { managerId: actor.id }, select: { id: true } });
  return led?.id ?? null;
}

async function requireManageableProject(actor: Actor, id: string) {
  const project = await requireVisibleProject(actor, id);
  // A Super Admin sees every department's projects, but manages only their own department's.
  if ((await projectDepartmentOf(actor)) !== project.departmentId) throw forbidden();
  await requireActiveDepartment(project.departmentId);
  return project;
}

async function requireActiveDepartment(departmentId: string) {
  const department = await prisma.department.findUnique({ where: { id: departmentId }, select: { status: true } });
  if (department?.status !== "Active") throw conflict("This department is archived.");
}

async function assertCodeFree(departmentId: string, code: string, exceptId?: string) {
  const clash = await prisma.project.findFirst({
    where: { departmentId, code: code.toUpperCase(), ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw conflict("A project with this code already exists in your department.");
}

/** Only active people from the project's own department can be assigned to it. */
async function assertAssignable(departmentId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  const valid = await prisma.user.count({ where: { id: { in: unique }, departmentId, isActive: true } });
  if (valid !== unique.length) {
    throw badRequest("Only active people in this department can be assigned to its projects.");
  }
  return unique;
}

function audit(actor: Actor, action: string, id: string, meta: Prisma.InputJsonObject) {
  return prisma.auditLog.create({
    data: { actorId: actor.id, action, targetType: "Project", targetId: id, meta },
  });
}

/**
 * Tells people they've been assigned to a project, in the app and by email. Whoever made the
 * assignment isn't told about adding themselves.
 */
async function notifyAssigned(
  actor: Actor,
  project: { id: string; name: string; departmentId: string },
  userIds: string[],
) {
  const recipients = userIds.filter((userId) => userId !== actor.id);
  if (recipients.length === 0) return;
  const assigner = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } });
  const by = assigner?.name ?? "Your manager";
  for (const recipientId of recipients) {
    await notify({
      recipientId,
      departmentId: project.departmentId,
      type: "PROJECT_ASSIGNED",
      title: `You've been assigned to ${project.name}`,
      message: `${by} assigned you to the project ${project.name}. You can now log your work on it.`,
      link: `/projects/${project.id}`,
      email: true,
    });
  }
}

/**
 * Checks a repository as soon as it is linked, so whoever pasted its address sees the result, or
 * why it can't be read, without waiting for the daily run. Saving never fails because of it:
 * auditProject stores a failure beside the project instead of throwing.
 */
async function auditLinkedRepository(project: Parameters<typeof auditProject>[0]) {
  if (!project.repository) return;
  // An unreadable saved token still counts: the check runs and stores that as its error.
  const connected = await credentialsFor(project.departmentId).catch((error) => error instanceof AuditError);
  if (connected) await auditProject(project);
}

export async function createProject(actor: Actor, input: CreateProjectInput) {
  const departmentId = await projectDepartmentOf(actor);
  if (!departmentId) {
    throw canManageProjects(actor) ? forbidden("You need a department before you can add projects.") : forbidden();
  }
  await requireActiveDepartment(departmentId);
  await assertCodeFree(departmentId, input.code);
  const memberIds = await assertAssignable(departmentId, input.memberIds);

  const project = await prisma.project.create({
    data: {
      name: input.name,
      code: input.code,
      description: input.description,
      color: input.color,
      status: input.status,
      repository: input.repository ?? null,
      departmentId,
      startDate: toDay(input.startDate),
      endDate: toDay(input.endDate),
      ownerId: actor.id,
      createdBy: actor.id,
      members: { create: memberIds.map((userId) => ({ userId })) },
    },
  });
  await audit(actor, "project.create", project.id, { memberCount: memberIds.length });
  await notifyAssigned(actor, project, memberIds);
  await auditLinkedRepository(project);
  return project;
}

export async function updateProject(actor: Actor, id: string, patch: UpdateProjectInput) {
  const project = await requireManageableProject(actor, id);
  if (patch.code) await assertCodeFree(project.departmentId, patch.code, id);

  const { startDate, endDate, ...fields } = patch;
  const nextStart = startDate !== undefined ? toDay(startDate) : project.startDate;
  const nextEnd = endDate !== undefined ? toDay(endDate) : project.endDate;
  // Checked here too, because a patch may change only one of the two dates.
  if (nextStart && nextEnd && nextEnd < nextStart) {
    throw badRequest("The end date can't be before the start date.");
  }
  const updated = await prisma.project.update({
    where: { id },
    data: { ...fields, startDate: nextStart, endDate: nextEnd },
  });
  // The stored result describes the old repository, so it goes, and the new one is checked now.
  if (fields.repository !== undefined && fields.repository !== project.repository) {
    await prisma.projectAudit.deleteMany({ where: { projectId: id } });
    await auditLinkedRepository(updated);
  }
  await audit(actor, "project.update", id, { changes: Object.keys(patch) });
  return updated;
}

export async function updateProjectMembers(actor: Actor, id: string, { add, remove }: UpdateMembersInput) {
  const project = await requireManageableProject(actor, id);
  const toAdd = await assertAssignable(project.departmentId, add);
  const removing = new Set(remove);
  const finalAdd = toAdd.filter((memberId) => !removing.has(memberId));

  const newlyAdded = await prisma.$transaction(async (tx) => {
    const existing = await tx.projectMember.findMany({
      where: { projectId: id, userId: { in: finalAdd } },
      select: { userId: true },
    });
    const already = new Set(existing.map((member) => member.userId));
    const fresh = finalAdd.filter((memberId) => !already.has(memberId));
    await tx.projectMember.createMany({
      data: fresh.map((userId) => ({ projectId: id, userId })),
      skipDuplicates: true,
    });
    await tx.projectMember.deleteMany({ where: { projectId: id, userId: { in: remove } } });
    return fresh;
  });
  await audit(actor, "project.members", id, { added: finalAdd, removed: remove });
  // Only people who weren't on the project before hear about it.
  await notifyAssigned(actor, project, newlyAdded);
}

/** Runs the dependency audit for one project now, instead of waiting for the daily run. */
export async function checkProjectDependencies(actor: Actor, id: string) {
  const project = await requireManageableProject(actor, id);
  if (!project.repository) throw badRequest("Link a Bitbucket repository to this project first.");
  // An unreadable saved token isn't "not connected": the check runs and stores that as its error.
  const connected = await credentialsFor(project.departmentId).catch((error) => error instanceof AuditError);
  if (!connected) {
    throw conflict(
      "Bitbucket isn't connected yet. Your manager connects it in Settings, or a Super Admin adds a token in Site settings.",
      "AUDIT_NOT_CONFIGURED",
    );
  }
  if (!(await consumeRateLimit(`audit:${id}`, CHECKS_PER_HOUR, 60 * 60 * 1000))) {
    throw tooManyRequests(`A project can be checked ${CHECKS_PER_HOUR} times an hour. Try again later.`);
  }
  return serialiseAudit(project.repository, await auditProject(project))!;
}

/** "workspace/repo" in lower case: what tells whether a repository already has a project. */
const repositoryKey = (repository: string) => repository.toLowerCase().split("/").slice(0, 2).join("/");

/**
 * The repositories in the department's Bitbucket account that no project of the department is
 * linked to yet. Null when the department hasn't connected Bitbucket.
 */
async function importableRepositories(departmentId: string) {
  const connection = await departmentConnection(departmentId);
  if (!connection) return null;
  const [repositories, linked] = await Promise.all([
    listRepositories(connection.credentials, connection.workspaces),
    prisma.project.findMany({ where: { departmentId, repository: { not: null } }, select: { repository: true } }),
  ]);
  const taken = new Set(linked.map((project) => repositoryKey(project.repository!)));
  // The address is checked like one typed into the project form, so nothing odd is stored.
  return repositories.filter(
    (repository) =>
      normaliseRepository(repository.fullName) === repository.fullName && !taken.has(repositoryKey(repository.fullName)),
  );
}

/**
 * What the Projects page offers to import. A Bitbucket problem is reported, not thrown, so the
 * page still loads.
 */
export async function bitbucketImportPreview(actor: Actor) {
  const departmentId = await bitbucketDepartmentOf(actor);
  if (!departmentId) throw forbidden();
  try {
    const repositories = await importableRepositories(departmentId);
    return {
      connected: repositories !== null,
      repositories: (repositories ?? []).map((repository) => repository.fullName),
      error: null as string | null,
    };
  } catch (error) {
    if (!(error instanceof AuditError)) throw error;
    return { connected: true, repositories: [] as string[], error: error.message as string | null };
  }
}

export type BitbucketImportPreview = Awaited<ReturnType<typeof bitbucketImportPreview>>;

/** A code no project of the department has: the repository's name, shortened, numbered if taken. */
function importCode(repository: BitbucketRepository, taken: Set<string>) {
  const letters = repository.slug.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base = (letters.length >= 2 ? letters : `${letters}REPO`).slice(0, 10);
  let code = base;
  for (let number = 2; taken.has(code); number += 1) code = `${base.slice(0, 10 - String(number).length)}${number}`;
  taken.add(code);
  return code;
}

/**
 * Adds a project for every repository in the department's Bitbucket account that doesn't have one
 * yet, linked to its repository. They start with no members; the daily audit picks them up.
 */
export async function importBitbucketProjects(actor: Actor) {
  const departmentId = await bitbucketDepartmentOf(actor);
  if (!departmentId) throw forbidden("Only a department's manager imports its Bitbucket projects.");
  await requireActiveDepartment(departmentId);
  if (!(await consumeRateLimit(`bitbucket-import:${departmentId}`, IMPORTS_PER_HOUR, 60 * 60 * 1000))) {
    throw tooManyRequests(`Projects can be imported ${IMPORTS_PER_HOUR} times an hour. Try again later.`);
  }

  let repositories: BitbucketRepository[] | null;
  try {
    repositories = await importableRepositories(departmentId);
  } catch (error) {
    if (error instanceof AuditError) throw badRequest(error.message, "BITBUCKET_REJECTED");
    throw error;
  }
  if (repositories === null) throw conflict("Connect Bitbucket in Settings first.", "BITBUCKET_NOT_CONNECTED");

  const existing = await prisma.project.findMany({ where: { departmentId }, select: { code: true } });
  const codes = new Set(existing.map((project) => project.code));
  const batch = repositories.slice(0, IMPORT_LIMIT);
  const data = batch.map((repository, index) => ({
    name: (repository.name.trim().length >= 2 ? repository.name.trim() : repository.fullName).slice(0, 80),
    code: importCode(repository, codes),
    description: repository.description.trim().slice(0, 1000),
    color: PALETTE[(existing.length + index) % PALETTE.length]!,
    repository: repository.fullName,
    departmentId,
    ownerId: actor.id,
    createdBy: actor.id,
  }));
  if (data.length > 0) {
    await prisma.project.createMany({ data });
    await prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "project.import",
        targetType: "Department",
        targetId: departmentId,
        meta: { count: data.length, repositories: data.map((project) => project.repository) },
      },
    });
  }
  return { imported: data.length, remaining: repositories.length - batch.length };
}

/** Only a project with no logged work can be deleted. Otherwise mark it Completed. */
export async function deleteProject(actor: Actor, id: string) {
  const project = await requireManageableProject(actor, id);
  if (await prisma.task.findFirst({ where: { projectId: id }, select: { id: true } })) {
    throw conflict("This project has logged work. Mark it as Completed instead.", "PROJECT_HAS_TASKS");
  }
  await prisma.project.delete({ where: { id } });
  await audit(actor, "project.delete", id, { name: project.name, code: project.code });
}

/** Hours, contributors and recent tasks, counting only reports this viewer is allowed to see. */
async function getProjectActivity(actor: Actor, projectId: string) {
  const visible = await visibleReportsFilter(actor);
  const taskWhere: Prisma.TaskWhereInput = { projectId, weeklyReport: visible };

  const [rows, recent, blockedCount] = await Promise.all([
    prisma.reportProjectTotal.findMany({
      where: { projectId, report: visible },
      select: { hours: true, report: { select: { weekStart: true, isoWeek: true, userId: true } } },
    }),
    prisma.task.findMany({
      where: taskWhere,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: RECENT_TASKS,
      include: { user: { select: { name: true, avatarColor: true } } },
    }),
    prisma.task.count({ where: { ...taskWhere, status: "Blocked" } }),
  ]);

  const weeks = new Map<string, { isoWeek: number; hours: number }>();
  const contributors = new Set<string>();
  let totalHours = 0;
  for (const row of rows) {
    const key = fromDay(row.report.weekStart)!;
    const week = weeks.get(key) ?? { isoWeek: row.report.isoWeek, hours: 0 };
    week.hours += row.hours;
    weeks.set(key, week);
    contributors.add(row.report.userId);
    totalHours += row.hours;
  }
  const byWeek = [...weeks]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-WEEKS_IN_CHART)
    .map(([, week]) => ({ label: `W${week.isoWeek}`, hours: week.hours }));

  return {
    totalHours,
    contributorCount: contributors.size,
    blockedCount,
    byWeek,
    recentTasks: recent.map((task) => ({
      id: task.id,
      date: fromDay(task.date),
      details: task.details,
      hours: task.hours,
      status: task.status as TaskStatus,
      user: { name: task.user.name, avatarColor: task.user.avatarColor as PaletteColor },
    })),
  };
}

/** Returns null when the actor can't see the project. */
export async function getProjectDetail(actor: Actor, id: string) {
  const project = await prisma.project.findFirst({
    where: { id, ...projectScope(actor) },
    include: { ...PROJECT_INCLUDE, audit: true },
  });
  if (!project) return null;
  return {
    ...serialise(project),
    audit: serialiseAudit(project.repository, project.audit),
    activity: await getProjectActivity(actor, project.id),
  };
}

export type ProjectSummary = ReturnType<typeof serialise>;
export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;
