import { subWeeks } from "date-fns";
import { Types } from "mongoose";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { SUBMITTED_STATUSES } from "@/lib/constants";
import { sendEmailSafely } from "@/lib/email";
import { departmentAssignedEmail, inviteEmail } from "@/lib/email/templates";
import { createNotification } from "@/lib/notifications";
import type { Actor } from "@/lib/permissions";
import { isoWeekOf, toUtcDay } from "@/lib/reports/iso-week";
import { avatarColorFor, newInvite, resolvePlacement } from "@/lib/users/service";
import { AuditLog, Department, Project, Task, User, WeeklyReport, type IDepartment } from "@/models";
import type {
  CreateDepartmentInput,
  ManagerAssignment,
  UpdateDepartmentInput,
} from "@/validators/department";

const MANAGER_FIELDS = "name email avatarColor";

async function assertNameAndCodeFree(
  input: { name?: string; code?: string },
  exceptId?: Types.ObjectId,
) {
  const clauses = [];
  if (input.name) clauses.push({ name: input.name });
  if (input.code) clauses.push({ code: input.code.toUpperCase() });
  if (clauses.length === 0) return;
  const clash = await Department.findOne({
    $or: clauses,
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  })
    .collation({ locale: "en", strength: 2 })
    .select("_id")
    .lean();
  if (clash) throw conflict("A department with this name or code already exists.");
}

/**
 * Gets the user who will manage a department. Never trusts the client's choice: an existing user
 * must be an active manager with no department. A new user is created unassigned and invited.
 */
async function prepareManager(assignment: ManagerAssignment) {
  if (assignment.mode === "existing") {
    const manager = await User.findOne({
      _id: assignment.userId,
      role: "MANAGER",
      departmentId: null,
      isActive: true,
    });
    if (!manager) throw badRequest("Pick an active Manager who has no department yet.");
    return { manager, invite: null };
  }
  if (await User.exists({ email: assignment.email })) {
    throw conflict("A user with this email already exists.", "EMAIL_TAKEN");
  }
  const placement = await resolvePlacement({ role: "MANAGER" });
  const { token, inviteTokenHash, inviteExpiresAt } = newInvite();
  const manager = await User.create({
    name: assignment.name,
    email: assignment.email,
    role: "MANAGER",
    ...placement,
    avatarColor: avatarColorFor(assignment.email),
    inviteTokenHash,
    inviteExpiresAt,
  });
  return { manager, invite: token };
}

/** Atomically claims the manager. Fails if another request assigned them in the meantime. */
async function claimManager(managerId: Types.ObjectId, departmentId: Types.ObjectId) {
  const claimed = await User.findOneAndUpdate(
    { _id: managerId, role: "MANAGER", departmentId: null },
    { departmentId },
  ).lean();
  if (!claimed) throw conflict("That Manager was just assigned to another department.");
}

async function notifyAssignedManager(
  manager: { _id: Types.ObjectId; name: string; email: string; preferences: { emailNotifications: boolean } },
  department: { _id: Types.ObjectId; name: string },
  invite: string | null,
) {
  await createNotification({
    recipientId: manager._id,
    departmentId: department._id,
    type: "DEPARTMENT_ASSIGNED",
    title: `You now manage ${department.name}`,
    message: `The CEO assigned you as manager of ${department.name}.`,
    link: "/dashboard",
  });
  if (invite) {
    await sendEmailSafely(
      inviteEmail({
        to: manager.email,
        name: manager.name,
        token: invite,
        departmentName: department.name,
      }),
    );
  } else if (manager.preferences.emailNotifications) {
    await sendEmailSafely(
      departmentAssignedEmail({
        to: manager.email,
        name: manager.name,
        departmentName: department.name,
      }),
    );
  }
}

export async function createDepartment(actor: Actor, input: CreateDepartmentInput) {
  await assertNameAndCodeFree(input);
  const { manager, invite } = await prepareManager(input.manager);

  let department;
  try {
    department = await Department.create({
      name: input.name,
      code: input.code,
      description: input.description,
      color: input.color,
      managerId: manager._id,
      createdBy: actor.id,
    });
    await claimManager(manager._id, department._id);
  } catch (error) {
    // No multi-document transactions on a standalone server, so undo by hand.
    if (department) await Department.deleteOne({ _id: department._id });
    if (invite) await User.deleteOne({ _id: manager._id });
    throw error;
  }

  await AuditLog.create({
    actorId: actor.id,
    action: "department.create",
    targetType: "Department",
    targetId: department._id,
    meta: { managerId: manager._id },
  });
  await notifyAssignedManager(manager, department, invite);
  return department;
}

export async function updateDepartment(
  actor: Actor,
  id: Types.ObjectId,
  patch: UpdateDepartmentInput,
) {
  await assertNameAndCodeFree(patch, id);
  const department = await Department.findByIdAndUpdate(id, patch, {
    new: true,
    runValidators: true,
  });
  if (!department) throw notFound();
  await AuditLog.create({
    actorId: actor.id,
    action: "department.update",
    targetType: "Department",
    targetId: id,
    meta: { changes: Object.keys(patch) },
  });
  return department;
}

/**
 * Hands a department to a new manager: their team leads and open reviews move with it, and the
 * previous manager becomes unassigned and available for another department.
 */
export async function changeDepartmentManager(
  actor: Actor,
  id: Types.ObjectId,
  assignment: ManagerAssignment,
) {
  const department = await Department.findById(id);
  if (!department) throw notFound();
  if (department.status !== "Active") throw badRequest("Restore this department first.");

  const { manager, invite } = await prepareManager(assignment);
  const previousManagerId = department.managerId;

  try {
    await claimManager(manager._id, department._id);
  } catch (error) {
    if (invite) await User.deleteOne({ _id: manager._id });
    throw error;
  }
  department.managerId = manager._id;
  await department.save();

  if (previousManagerId) {
    await Promise.all([
      User.updateOne({ _id: previousManagerId }, { departmentId: null }),
      User.updateMany(
        { departmentId: department._id, reportsTo: previousManagerId },
        { reportsTo: manager._id },
      ),
      WeeklyReport.updateMany(
        { departmentId: department._id, currentApproverId: previousManagerId },
        { currentApproverId: manager._id },
      ),
      Project.updateMany(
        { departmentId: department._id, memberIds: previousManagerId },
        { $pull: { memberIds: previousManagerId } },
      ),
    ]);
    await createNotification({
      recipientId: previousManagerId,
      departmentId: null,
      type: "DEPARTMENT_UNASSIGNED",
      title: `You no longer manage ${department.name}`,
      message: `The CEO assigned a new manager to ${department.name}.`,
      link: "/dashboard",
    });
  }

  await AuditLog.create({
    actorId: actor.id,
    action: "department.change_manager",
    targetType: "Department",
    targetId: id,
    meta: { previousManagerId, managerId: manager._id },
  });
  await notifyAssignedManager(manager, department, invite);
  return department;
}

export async function setDepartmentArchived(actor: Actor, id: Types.ObjectId, archived: boolean) {
  const department = await Department.findByIdAndUpdate(
    id,
    { status: archived ? "Archived" : "Active" },
    { new: true },
  );
  if (!department) throw notFound();
  await AuditLog.create({
    actorId: actor.id,
    action: archived ? "department.archive" : "department.restore",
    targetType: "Department",
    targetId: id,
    meta: {},
  });
  return department;
}

async function departmentHasData(department: { _id: Types.ObjectId; managerId: Types.ObjectId | null }) {
  const filter = { departmentId: department._id };
  const [people, project, task, report] = await Promise.all([
    User.exists({ ...filter, _id: { $ne: department.managerId } }),
    Project.exists(filter),
    Task.exists(filter),
    WeeklyReport.exists(filter),
  ]);
  return Boolean(people || project || task || report);
}

/** Only an empty department can be deleted. One with data must be archived instead. */
export async function deleteDepartment(actor: Actor, id: Types.ObjectId) {
  const department = await Department.findById(id).lean();
  if (!department) throw notFound();
  if (await departmentHasData(department)) {
    throw conflict("This department has data. Archive it instead.", "DEPARTMENT_HAS_DATA");
  }
  await Department.deleteOne({ _id: id });
  await User.updateMany({ departmentId: id }, { departmentId: null });
  await AuditLog.create({
    actorId: actor.id,
    action: "department.delete",
    targetType: "Department",
    targetId: id,
    meta: { name: department.name, code: department.code },
  });
}

type WithManager = Omit<IDepartment, "managerId"> & {
  managerId: { _id: Types.ObjectId; name: string; email: string; avatarColor: string } | null;
};

function serialise(department: WithManager) {
  return {
    id: String(department._id),
    name: department.name,
    code: department.code,
    description: department.description,
    color: department.color,
    status: department.status,
    manager: department.managerId
      ? {
          id: String(department.managerId._id),
          name: department.managerId.name,
          email: department.managerId.email,
          avatarColor: department.managerId.avatarColor,
        }
      : null,
  };
}

/** Headcount, active projects and submission rate for many departments, in three aggregations. */
export async function listDepartmentsWithStats(filter: { _id?: unknown }, now = new Date()) {
  const departments = await Department.find(filter)
    .sort({ status: 1, name: 1 })
    .populate<{ managerId: WithManager["managerId"] }>("managerId", MANAGER_FIELDS)
    .lean();
  const ids = departments.map((department) => department._id);
  const { isoYear, isoWeek } = isoWeekOf(now);

  const [headcounts, activeProjects, submitted] = await Promise.all([
    User.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { departmentId: { $in: ids }, isActive: true } },
      { $group: { _id: "$departmentId", count: { $sum: 1 } } },
    ]),
    Project.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { departmentId: { $in: ids }, status: "Active" } },
      { $group: { _id: "$departmentId", count: { $sum: 1 } } },
    ]),
    WeeklyReport.aggregate<{ _id: Types.ObjectId; count: number }>([
      {
        $match: {
          departmentId: { $in: ids },
          isoYear,
          isoWeek,
          status: { $in: SUBMITTED_STATUSES },
        },
      },
      { $group: { _id: "$departmentId", count: { $sum: 1 } } },
    ]),
  ]);

  const byId = (rows: { _id: Types.ObjectId; count: number }[]) =>
    new Map(rows.map((row) => [String(row._id), row.count]));
  const headcountById = byId(headcounts);
  const projectsById = byId(activeProjects);
  const submittedById = byId(submitted);

  return departments.map((department) => {
    const id = String(department._id);
    const headcount = headcountById.get(id) ?? 0;
    const submittedCount = submittedById.get(id) ?? 0;
    return {
      ...serialise(department),
      headcount,
      activeProjects: projectsById.get(id) ?? 0,
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
export async function getDepartmentDetail(id: Types.ObjectId, now = new Date()) {
  const [summary] = await listDepartmentsWithStats({ _id: id }, now);
  if (!summary) return null;

  const since = toUtcDay(subWeeks(now, WEEKS_IN_MINI_DASHBOARD));
  const approved = { departmentId: id, status: "MANAGER_APPROVED", weekStart: { $gte: since } };

  const [people, projects, hoursByWeek, hoursByProject, canDelete] = await Promise.all([
    User.find({ departmentId: id })
      .select("name email role avatarColor isActive reportsTo")
      .sort({ name: 1 })
      .lean(),
    Project.find({ departmentId: id }).select("name code color status").sort({ name: 1 }).lean(),
    WeeklyReport.aggregate<{ _id: Date; hours: number; isoWeek: number }>([
      { $match: approved },
      {
        $group: {
          _id: "$weekStart",
          hours: { $sum: "$totals.hours" },
          isoWeek: { $first: "$isoWeek" },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    WeeklyReport.aggregate<{ _id: Types.ObjectId; hours: number }>([
      { $match: approved },
      { $unwind: "$totals.byProject" },
      { $group: { _id: "$totals.byProject.projectId", hours: { $sum: "$totals.byProject.hours" } } },
      { $sort: { hours: -1 } },
    ]),
    Department.findById(id)
      .lean()
      .then((department) => (department ? departmentHasData(department).then((has) => !has) : false)),
  ]);

  const serialisePerson = (person: (typeof people)[number]) => ({
    id: String(person._id),
    name: person.name,
    email: person.email,
    avatarColor: person.avatarColor,
    isActive: person.isActive,
    reportsTo: person.reportsTo ? String(person.reportsTo) : null,
  });
  const projectById = new Map(projects.map((project) => [String(project._id), project]));

  return {
    ...summary,
    canDelete,
    teamLeads: people.filter((person) => person.role === "TEAM_LEAD").map(serialisePerson),
    developers: people.filter((person) => person.role === "DEVELOPER").map(serialisePerson),
    projects: projects.map((project) => ({
      id: String(project._id),
      name: project.name,
      code: project.code,
      color: project.color,
      status: project.status,
    })),
    approved: {
      totalHours: hoursByWeek.reduce((sum, week) => sum + week.hours, 0),
      byWeek: hoursByWeek.map((week) => ({ label: `W${week.isoWeek}`, hours: week.hours })),
      byProject: hoursByProject.flatMap((row) => {
        const project = projectById.get(String(row._id));
        return project ? [{ name: project.name, color: project.color, hours: row.hours }] : [];
      }),
    },
  };
}

export type DepartmentSummary = Awaited<ReturnType<typeof listDepartmentsWithStats>>[number];
export type DepartmentDetail = NonNullable<Awaited<ReturnType<typeof getDepartmentDetail>>>;

