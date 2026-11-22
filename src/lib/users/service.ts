import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { PALETTE, REPORTS_TO_ROLE, ROLE_LABELS, seesAllDepartments, type Role } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { sendEmailSafely } from "@/lib/email";
import { welcomeEmail } from "@/lib/email/templates";
import { canAssignOrgWideRoles, type Actor } from "@/lib/permissions";
import type { CreateUserInput, UpdateUserInput } from "@/validators/user";

export const avatarColorFor = (email: string) =>
  PALETTE[[...email].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE.length]!;

/**
 * The integrity rules for where a user sits in the org:
 * - The Super Admin and the CEO sit above the departments and report to nobody.
 * - A manager reports to the CEO, once there is one. Their department is set only through
 *   department assignment.
 * - A team lead reports to their department's manager.
 * - A developer reports to an active team lead in their department.
 * Returns the validated placement to store.
 */
export async function resolvePlacement(input: {
  role: Role;
  departmentId?: string | null;
  reportsTo?: string | null;
}): Promise<{ departmentId: string | null; reportsTo: string | null }> {
  if (seesAllDepartments(input.role)) return { departmentId: null, reportsTo: null };

  if (input.role === "MANAGER") {
    const ceo = await prisma.user.findFirst({ where: { role: "CEO" }, select: { id: true } });
    return { departmentId: null, reportsTo: ceo?.id ?? null };
  }

  if (!input.departmentId) throw badRequest(`A ${ROLE_LABELS[input.role]} needs a department.`);
  const department = await prisma.department.findUnique({ where: { id: input.departmentId } });
  if (!department) throw badRequest("That department doesn't exist.");
  if (department.status !== "Active") throw badRequest("That department is archived.");

  if (input.role === "TEAM_LEAD") {
    if (!department.managerId) throw conflict(`${department.name} has no manager yet.`);
    if (input.reportsTo && input.reportsTo !== department.managerId) {
      throw badRequest("A Team Lead must report to their department's Manager.");
    }
    return { departmentId: department.id, reportsTo: department.managerId };
  }

  if (!input.reportsTo) throw badRequest("A Developer must report to a Team Lead.");
  const lead = await prisma.user.findFirst({
    where: {
      id: input.reportsTo,
      departmentId: department.id,
      role: REPORTS_TO_ROLE.DEVELOPER!,
      isActive: true,
      approval: "APPROVED",
    },
    select: { id: true },
  });
  if (!lead) throw badRequest("A Developer must report to an active Team Lead in their department.");
  return { departmentId: department.id, reportsTo: lead.id };
}

/**
 * Adds someone before they've ever signed in. They're approved from the start, and get an email
 * telling them to sign in with their Microsoft account.
 */
export async function createUser(actor: Actor, input: CreateUserInput) {
  if (input.role === "MANAGER" && input.departmentId) {
    throw badRequest("Assign a Manager to a department from the Departments page.");
  }
  const placement = await resolvePlacement(input);
  if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw conflict("A user with this email already exists.", "EMAIL_TAKEN");
  }
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      role: input.role,
      ...placement,
      avatarColor: avatarColorFor(input.email),
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "user.create",
      targetType: "User",
      targetId: user.id,
      meta: { role: user.role, departmentId: user.departmentId },
    },
  });
  await sendEmailSafely(welcomeEmail({ to: user.email, name: user.name }));
  return user;
}

/**
 * Applies an edit from the Users page. Changing someone's role or department, or deactivating
 * them, would orphan anyone reporting to them, so those changes are refused until their reports
 * are moved. Past reports keep their departmentId, as they stay with the old department.
 *
 * `approve` also lets a waiting or rejected person in, in the same write as their placement.
 */
export async function updateUser(
  actor: Actor,
  id: string,
  patch: UpdateUserInput,
  options: { approve?: boolean } = {},
) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound();

  const nextRole = patch.role ?? user.role;
  const roleChanging = nextRole !== user.role;
  const deactivating = patch.isActive === false && user.isActive;

  // The Super Admin and CEO roles are a Super Admin's to give, change or take away.
  if ((seesAllDepartments(user.role) || seesAllDepartments(nextRole)) && !canAssignOrgWideRoles(actor)) {
    if (user.role !== "CEO") throw forbidden("Only a Super Admin can change this role.");
    if (patch.name === undefined || Object.keys(patch).length > 1) {
      throw badRequest("Only the CEO's name can be changed.");
    }
    return prisma.user.update({ where: { id }, data: { name: patch.name } });
  }
  if (id === actor.id && (roleChanging || deactivating)) {
    throw badRequest("You can't change your own role or deactivate yourself. Ask another Super Admin.");
  }

  const departmentChanging = patch.departmentId !== undefined && patch.departmentId !== user.departmentId;
  const previousDepartmentId = user.departmentId;
  const leavingCeo = roleChanging && user.role === "CEO";
  const becomingCeo = roleChanging && nextRole === "CEO";

  if (roleChanging || departmentChanging || deactivating) {
    const managedDepartment = await prisma.department.findFirst({ where: { managerId: id }, select: { id: true } });
    if (managedDepartment) {
      throw conflict(
        "This person manages a department. Assign a new manager to it first.",
        "IS_DEPARTMENT_MANAGER",
      );
    }
    // A CEO changing role hands the Managers on (below), so they don't block it.
    const report = leavingCeo
      ? null
      : await prisma.user.findFirst({ where: { reportsTo: id, isActive: true }, select: { id: true } });
    if (report) {
      throw conflict("Move this person's direct reports first.", "HAS_DIRECT_REPORTS");
    }
  }

  if (nextRole === "MANAGER" && departmentChanging && patch.departmentId) {
    throw badRequest("Assign a Manager to a department from the Departments page.");
  }
  if (becomingCeo) {
    const current = await prisma.user.findFirst({ where: { role: "CEO", id: { not: id } }, select: { name: true } });
    if (current) throw conflict(`${current.name} is already the CEO. Change their role first.`, "CEO_EXISTS");
  }

  let placement = { departmentId: user.departmentId, reportsTo: user.reportsTo };
  const reportsToChanging = patch.reportsTo !== undefined;
  // An approval always places the person, even when the role they're given is the placeholder
  // they were waiting with.
  if (options.approve || roleChanging || departmentChanging || reportsToChanging) {
    placement = await resolvePlacement({
      role: nextRole,
      departmentId:
        nextRole === "MANAGER"
          ? null
          : patch.departmentId !== undefined
            ? patch.departmentId
            : user.departmentId,
      // A role or department change invalidates the old approver, so it isn't carried over.
      reportsTo:
        patch.reportsTo !== undefined
          ? patch.reportsTo
          : roleChanging || departmentChanging
            ? null
            : user.reportsTo,
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.user.update({
      where: { id },
      data: {
        ...placement,
        role: nextRole,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        ...(options.approve ? { approval: "APPROVED" as const } : {}),
      },
    });
    if (previousDepartmentId !== saved.departmentId) {
      // Project membership is per department. Membership can't follow someone to a new one.
      await tx.projectMember.deleteMany({ where: { userId: id } });
    }
    if (leavingCeo) {
      // Managers and their submitted weeks wait for the next CEO.
      await tx.user.updateMany({ where: { reportsTo: id, role: "MANAGER" }, data: { reportsTo: null } });
      await tx.weeklyReport.updateMany({ where: { currentApproverId: id }, data: { currentApproverId: null } });
    }
    if (becomingCeo) {
      await tx.user.updateMany({ where: { role: "MANAGER" }, data: { reportsTo: id } });
      await tx.weeklyReport.updateMany({
        where: { status: "SUBMITTED", currentApproverId: null, user: { role: "MANAGER" } },
        data: { currentApproverId: id },
      });
    }
    return saved;
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: options.approve ? "user.approve" : "user.update",
      targetType: "User",
      targetId: id,
      meta: { changes: Object.keys(patch), role: nextRole, previousDepartmentId },
    },
  });
  return updated;
}
