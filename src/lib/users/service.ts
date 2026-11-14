import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { hashPassword } from "@/lib/auth/password";
import { PALETTE, REPORTS_TO_ROLE, ROLE_LABELS, type Role } from "@/lib/constants";
import { sendEmailSafely } from "@/lib/email";
import { inviteEmail } from "@/lib/email/templates";
import type { Actor } from "@/lib/permissions";
import { AuditLog, Department, Project, User } from "@/models";
import type { CreateUserInput, UpdateUserInput } from "@/validators/user";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const avatarColorFor = (email: string) =>
  PALETTE[[...email].reduce((sum, char) => sum + char.charCodeAt(0), 0) % PALETTE.length]!;

async function getCEO() {
  const ceo = await User.findOne({ role: "CEO" }).select("_id").lean();
  if (!ceo) throw conflict("No CEO account exists. Run the seed script first.");
  return ceo;
}

/**
 * The integrity rules for where a user sits in the org:
 * - A manager reports to the CEO. Their department is set only through department assignment.
 * - A team lead reports to their department's manager.
 * - A developer reports to an active team lead in their department.
 * Returns the validated placement to store.
 */
export async function resolvePlacement(input: {
  role: Exclude<Role, "CEO">;
  departmentId?: string | Types.ObjectId | null;
  reportsTo?: string | Types.ObjectId | null;
}) {
  if (input.role === "MANAGER") {
    const ceo = await getCEO();
    return { departmentId: null, reportsTo: ceo._id };
  }

  if (!input.departmentId) throw badRequest(`A ${ROLE_LABELS[input.role]} needs a department.`);
  const department = await Department.findById(input.departmentId).lean();
  if (!department) throw badRequest("That department doesn't exist.");
  if (department.status !== "Active") throw badRequest("That department is archived.");

  if (input.role === "TEAM_LEAD") {
    if (!department.managerId) throw conflict(`${department.name} has no manager yet.`);
    if (input.reportsTo && String(input.reportsTo) !== String(department.managerId)) {
      throw badRequest("A Team Lead must report to their department's Manager.");
    }
    return { departmentId: department._id, reportsTo: department.managerId };
  }

  if (!input.reportsTo) throw badRequest("A Developer must report to a Team Lead.");
  const lead = await User.findOne({
    _id: input.reportsTo,
    departmentId: department._id,
    role: REPORTS_TO_ROLE.DEVELOPER,
    isActive: true,
  })
    .select("_id")
    .lean();
  if (!lead) throw badRequest("A Developer must report to an active Team Lead in their department.");
  return { departmentId: department._id, reportsTo: lead._id };
}

/** Creates an invite token. Only its hash is stored. */
export function newInvite() {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    inviteTokenHash: hashToken(token),
    inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
  };
}

export async function createUser(actor: Actor, input: CreateUserInput) {
  if (input.role === "MANAGER" && input.departmentId) {
    throw badRequest("Assign a Manager to a department from the Departments page.");
  }
  const placement = await resolvePlacement(input as Parameters<typeof resolvePlacement>[0]);
  if (await User.exists({ email: input.email })) {
    throw conflict("A user with this email already exists.", "EMAIL_TAKEN");
  }
  const { token, inviteTokenHash, inviteExpiresAt } = newInvite();
  const user = await User.create({
    name: input.name,
    email: input.email,
    role: input.role,
    ...placement,
    avatarColor: avatarColorFor(input.email),
    inviteTokenHash,
    inviteExpiresAt,
  });
  await AuditLog.create({
    actorId: actor.id,
    action: "user.create",
    targetType: "User",
    targetId: user._id,
    meta: { role: user.role, departmentId: user.departmentId },
  });
  await sendEmailSafely(inviteEmail({ to: user.email, name: user.name, token }));
  return user;
}

/**
 * Applies an admin edit. Changing someone's role or department, or deactivating them, would
 * orphan anyone reporting to them, so those changes are refused until their reports are moved.
 * Past reports keep their departmentId, as they stay with the old department.
 */
export async function updateUser(actor: Actor, id: Types.ObjectId, patch: UpdateUserInput) {
  const user = await User.findById(id);
  if (!user) throw notFound();

  if (user.role === "CEO") {
    if (patch.name === undefined || Object.keys(patch).length > 1) {
      throw badRequest("Only the CEO's name can be changed.");
    }
    user.name = patch.name;
    await user.save();
    return user;
  }

  const nextRole = patch.role ?? user.role;
  const departmentChanging =
    patch.departmentId !== undefined && String(patch.departmentId) !== String(user.departmentId);
  const roleChanging = nextRole !== user.role;
  const deactivating = patch.isActive === false && user.isActive;
  const previousDepartmentId = user.departmentId;

  if (roleChanging || departmentChanging || deactivating) {
    const isDepartmentManager = await Department.exists({ managerId: user._id });
    if (isDepartmentManager) {
      throw conflict(
        "This person manages a department. Assign a new manager to it first.",
        "IS_DEPARTMENT_MANAGER",
      );
    }
    const hasReports = await User.exists({ reportsTo: user._id, isActive: true });
    if (hasReports) {
      throw conflict("Move this person's direct reports first.", "HAS_DIRECT_REPORTS");
    }
  }

  if (nextRole === "MANAGER" && departmentChanging && patch.departmentId) {
    throw badRequest("Assign a Manager to a department from the Departments page.");
  }

  const reportsToChanging = patch.reportsTo !== undefined;
  if (roleChanging || departmentChanging || reportsToChanging) {
    const placement = await resolvePlacement({
      role: nextRole as Exclude<Role, "CEO">,
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
    user.departmentId = placement.departmentId;
    user.reportsTo = placement.reportsTo;
  }

  user.role = nextRole;
  if (patch.name !== undefined) user.name = patch.name;
  if (patch.isActive !== undefined) user.isActive = patch.isActive;
  await user.save();

  if (String(previousDepartmentId) !== String(user.departmentId)) {
    // Project membership is per department. Membership can't follow someone to a new one.
    await Project.updateMany({ memberIds: user._id }, { $pull: { memberIds: user._id } });
  }

  await AuditLog.create({
    actorId: actor.id,
    action: "user.update",
    targetType: "User",
    targetId: user._id,
    meta: { changes: Object.keys(patch), previousDepartmentId },
  });
  return user;
}

export async function acceptInvite(token: string, password: string) {
  const user = await User.findOne({
    inviteTokenHash: hashToken(token),
    inviteExpiresAt: { $gt: new Date() },
    isActive: true,
  }).select("+inviteTokenHash +inviteExpiresAt +passwordHash");
  if (!user) throw badRequest("This invite link is invalid or has expired.", "INVALID_INVITE");
  user.passwordHash = await hashPassword(password);
  user.inviteTokenHash = null;
  user.inviteExpiresAt = null;
  await user.save();
  return { email: user.email };
}

export async function inviteIsValid(token: string) {
  return Boolean(
    await User.exists({
      inviteTokenHash: hashToken(token),
      inviteExpiresAt: { $gt: new Date() },
      isActive: true,
    }),
  );
}

