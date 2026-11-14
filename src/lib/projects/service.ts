import { Types, type FilterQuery } from "mongoose";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { canManageProjects, projectScope, type Actor } from "@/lib/permissions";
import { visibleReportsFilter } from "@/lib/reports/visibility";
import { escapeRegex } from "@/lib/utils";
import { AuditLog, Department, Project, Task, User, WeeklyReport, type IProject } from "@/models";
import type {
  CreateProjectInput,
  ListProjectsQuery,
  UpdateMembersInput,
  UpdateProjectInput,
} from "@/validators/project";

const WEEKS_IN_CHART = 8;
const RECENT_TASKS = 10;

const toDay = (value: string | null | undefined) =>
  value ? new Date(`${value}T00:00:00.000Z`) : null;
const fromDay = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

interface PersonRef {
  _id: Types.ObjectId;
  name: string;
  role: string;
  avatarColor: string;
  isActive: boolean;
}

interface DepartmentRef {
  _id: Types.ObjectId;
  name: string;
  code: string;
  color: string;
}

type PopulatedProject = Omit<IProject, "memberIds" | "departmentId"> & {
  memberIds: PersonRef[];
  departmentId: DepartmentRef;
};

const PROJECT_POPULATE = [
  { path: "memberIds", select: "name role avatarColor isActive" },
  { path: "departmentId", select: "name code color" },
];

function serialise(project: PopulatedProject) {
  return {
    id: String(project._id),
    name: project.name,
    code: project.code,
    description: project.description,
    color: project.color,
    status: project.status,
    startDate: fromDay(project.startDate),
    endDate: fromDay(project.endDate),
    department: {
      id: String(project.departmentId._id),
      name: project.departmentId.name,
      code: project.departmentId.code,
      color: project.departmentId.color,
    },
    members: project.memberIds.map((member) => ({
      id: String(member._id),
      name: member.name,
      role: member.role,
      avatarColor: member.avatarColor,
      isActive: member.isActive,
    })),
  };
}

export async function listProjects(
  actor: Actor,
  selectedDepartmentId: string | null,
  query: ListProjectsQuery,
) {
  // projectScope ignores the requested department for everyone but the CEO.
  const filter: FilterQuery<IProject> = {
    ...projectScope(actor, query.departmentId ?? selectedDepartmentId),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          $or: [
            { name: { $regex: escapeRegex(query.search), $options: "i" } },
            { code: { $regex: escapeRegex(query.search), $options: "i" } },
          ],
        }
      : {}),
  };
  const [projects, total] = await Promise.all([
    Project.find(filter)
      .sort({ name: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .populate<{ memberIds: PersonRef[]; departmentId: DepartmentRef }>(PROJECT_POPULATE)
      .lean(),
    Project.countDocuments(filter),
  ]);
  return { projects: projects.map(serialise), total };
}

/**
 * Finds a project the actor may see, or throws a 404. Always call this before any role check, so
 * a project outside the actor's visibility is a 404 rather than a 403.
 */
async function requireVisibleProject(actor: Actor, id: Types.ObjectId) {
  const project = await Project.findOne({ _id: id, ...projectScope(actor) });
  if (!project) throw notFound();
  return project;
}

async function requireManageableProject(actor: Actor, id: Types.ObjectId) {
  const project = await requireVisibleProject(actor, id);
  if (!canManageProjects(actor)) throw forbidden();
  await requireActiveDepartment(project.departmentId);
  return project;
}

async function requireActiveDepartment(departmentId: Types.ObjectId) {
  const department = await Department.findById(departmentId).select("status").lean();
  if (department?.status !== "Active") throw conflict("This department is archived.");
}

async function assertCodeFree(departmentId: Types.ObjectId, code: string, exceptId?: Types.ObjectId) {
  const clash = await Project.exists({
    departmentId,
    code: code.toUpperCase(),
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  });
  if (clash) throw conflict("A project with this code already exists in your department.");
}

/** Only active people from the project's own department can be assigned to it. */
async function assertAssignable(departmentId: Types.ObjectId, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  const valid = await User.countDocuments({ _id: { $in: unique }, departmentId, isActive: true });
  if (valid !== unique.length) {
    throw badRequest("Only active people in this department can be assigned to its projects.");
  }
  return unique;
}

function audit(actor: Actor, action: string, id: Types.ObjectId, meta: Record<string, unknown>) {
  return AuditLog.create({ actorId: actor.id, action, targetType: "Project", targetId: id, meta });
}

export async function createProject(actor: Actor, input: CreateProjectInput) {
  if (!canManageProjects(actor)) throw forbidden();
  if (!actor.departmentId) throw forbidden("You need a department before you can add projects.");
  const departmentId = new Types.ObjectId(actor.departmentId);
  await requireActiveDepartment(departmentId);
  await assertCodeFree(departmentId, input.code);
  const memberIds = await assertAssignable(departmentId, input.memberIds);

  const project = await Project.create({
    ...input,
    departmentId,
    startDate: toDay(input.startDate),
    endDate: toDay(input.endDate),
    memberIds,
    ownerId: actor.id,
    createdBy: actor.id,
  });
  await audit(actor, "project.create", project._id, { memberCount: memberIds.length });
  return project;
}

export async function updateProject(actor: Actor, id: Types.ObjectId, patch: UpdateProjectInput) {
  const project = await requireManageableProject(actor, id);
  if (patch.code) await assertCodeFree(project.departmentId, patch.code, id);

  const { startDate, endDate, ...fields } = patch;
  project.set(fields);
  if (startDate !== undefined) project.startDate = toDay(startDate);
  if (endDate !== undefined) project.endDate = toDay(endDate);
  // Checked here too, because a patch may change only one of the two dates.
  if (project.startDate && project.endDate && project.endDate < project.startDate) {
    throw badRequest("The end date can't be before the start date.");
  }
  await project.save();
  await audit(actor, "project.update", id, { changes: Object.keys(patch) });
  return project;
}

export async function updateProjectMembers(
  actor: Actor,
  id: Types.ObjectId,
  { add, remove }: UpdateMembersInput,
) {
  const project = await requireManageableProject(actor, id);
  const toAdd = await assertAssignable(project.departmentId, add);
  const removing = new Set(remove);
  const finalAdd = toAdd.filter((memberId) => !removing.has(memberId));
  const toObjectIds = (ids: string[]) => ids.map((memberId) => new Types.ObjectId(memberId));

  // $addToSet and $pullAll can't target one array in a single update, so these run in order.
  await Project.bulkWrite([
    {
      updateOne: {
        filter: { _id: id },
        update: { $addToSet: { memberIds: { $each: toObjectIds(finalAdd) } } },
      },
    },
    {
      updateOne: {
        filter: { _id: id },
        update: { $pullAll: { memberIds: toObjectIds(remove) } },
      },
    },
  ]);
  await audit(actor, "project.members", id, { added: finalAdd, removed: remove });
}

/** Only a project with no logged work can be deleted. Otherwise mark it Completed. */
export async function deleteProject(actor: Actor, id: Types.ObjectId) {
  const project = await requireManageableProject(actor, id);
  if (await Task.exists({ projectId: id })) {
    throw conflict("This project has logged work. Mark it as Completed instead.", "PROJECT_HAS_TASKS");
  }
  await project.deleteOne();
  await audit(actor, "project.delete", id, { name: project.name, code: project.code });
}

/** Hours, contributors and recent tasks, counting only reports this viewer is allowed to see. */
async function getProjectActivity(actor: Actor, project: { _id: Types.ObjectId }) {
  const projectId = project._id;
  const reportFilter = {
    $and: [await visibleReportsFilter(actor), { "totals.byProject.projectId": projectId }],
  };
  const projectRows = [
    { $match: reportFilter },
    { $unwind: "$totals.byProject" },
    { $match: { "totals.byProject.projectId": projectId } },
  ];

  const [byWeek, totals, reports] = await Promise.all([
    WeeklyReport.aggregate<{ _id: Date; hours: number; isoWeek: number }>([
      ...projectRows,
      {
        $group: {
          _id: "$weekStart",
          hours: { $sum: "$totals.byProject.hours" },
          isoWeek: { $first: "$isoWeek" },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: WEEKS_IN_CHART },
    ]),
    WeeklyReport.aggregate<{ hours: number; contributors: Types.ObjectId[] }>([
      ...projectRows,
      {
        $group: {
          _id: null,
          hours: { $sum: "$totals.byProject.hours" },
          contributors: { $addToSet: "$userId" },
        },
      },
    ]),
    WeeklyReport.find(reportFilter).select("_id").lean(),
  ]);

  const taskFilter = { projectId, weeklyReportId: { $in: reports.map((report) => report._id) } };
  const [recent, blockedCount] = await Promise.all([
    Task.find(taskFilter)
      .sort({ date: -1, createdAt: -1 })
      .limit(RECENT_TASKS)
      .populate<{ userId: { name: string; avatarColor: string } }>("userId", "name avatarColor")
      .lean(),
    Task.countDocuments({ ...taskFilter, status: "Blocked" }),
  ]);

  return {
    totalHours: totals[0]?.hours ?? 0,
    contributorCount: totals[0]?.contributors.length ?? 0,
    blockedCount,
    byWeek: byWeek.reverse().map((week) => ({ label: `W${week.isoWeek}`, hours: week.hours })),
    recentTasks: recent.map((task) => ({
      id: String(task._id),
      date: fromDay(task.date),
      details: task.details,
      hours: task.hours,
      status: task.status,
      user: { name: task.userId.name, avatarColor: task.userId.avatarColor },
    })),
  };
}

/** Returns null when the actor can't see the project. */
export async function getProjectDetail(actor: Actor, id: Types.ObjectId) {
  const project = await Project.findOne({ _id: id, ...projectScope(actor) })
    .populate<{ memberIds: PersonRef[]; departmentId: DepartmentRef }>(PROJECT_POPULATE)
    .lean();
  if (!project) return null;
  return { ...serialise(project), activity: await getProjectActivity(actor, project) };
}

export type ProjectSummary = ReturnType<typeof serialise>;
export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;
