import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { isUniqueViolation, prisma } from "@/lib/db/prisma";
import { changeDepartmentManager, ensureItDepartment } from "@/lib/departments/service";
import { sendEmailSafely } from "@/lib/email";
import { accessApprovedEmail } from "@/lib/email/templates";
import { notify, receivesEmail } from "@/lib/notifications";
import type { Actor } from "@/lib/permissions";
import type { ApproveUserInput } from "@/validators/user";
import { avatarColorFor, updateUser } from "./service";

// Who gets into GET List. Microsoft proves who someone is; this file decides what happens next.
//
//   first sign-in ──▶ PENDING ──approve (role, department)──▶ APPROVED ──▶ signed in
//                        └────────────reject──────────────▶ REJECTED
//
// The emails in SUPER_ADMIN_EMAILS skip the queue: they're Super Admins from their first sign-in,
// which is how the first person gets in to approve everyone else.

/** Lower-cased emails from SUPER_ADMIN_EMAILS, separated by commas, semicolons or spaces. */
export function superAdminEmails() {
  return (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export type SignInOutcome = "signed-in" | "pending" | "rejected" | "inactive";

const findByEmail = (email: string) =>
  prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

async function othersDependOn(userId: string) {
  const [department, report] = await Promise.all([
    prisma.department.findFirst({ where: { managerId: userId }, select: { id: true } }),
    prisma.user.findFirst({ where: { reportsTo: userId, isActive: true }, select: { id: true } }),
  ]);
  return Boolean(department || report);
}

async function tellSuperAdmins(person: { name: string; email: string }) {
  const admins = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN", isActive: true, approval: "APPROVED" },
    select: { id: true },
  });
  for (const admin of admins) {
    await notify({
      recipientId: admin.id,
      departmentId: null,
      type: "USER_PENDING",
      title: `${person.name} is waiting for approval`,
      message: `${person.name} (${person.email}) signed in with Microsoft for the first time. Approve them and choose their role on the Users page.`,
      link: "/users?status=PENDING",
      email: true,
    });
  }
}

/**
 * Finds, or on a first sign-in creates, the GET List account for someone Microsoft has just
 * identified, and says whether they may come in.
 */
export async function resolveMicrosoftSignIn(identity: { email: string; name: string }) {
  const email = identity.email.trim().toLowerCase();
  const isSuperAdmin = superAdminEmails().includes(email);

  let user = await findByEmail(email);
  if (!user) {
    try {
      user = await prisma.user.create({
        data: {
          name: identity.name,
          email,
          role: isSuperAdmin ? "SUPER_ADMIN" : "DEVELOPER",
          approval: isSuperAdmin ? "APPROVED" : "PENDING",
          avatarColor: avatarColorFor(email),
        },
      });
      if (!isSuperAdmin) await tellSuperAdmins(user);
    } catch (error) {
      // Two first sign-ins at once: the other request created the account.
      if (!isUniqueViolation(error)) throw error;
      user = await findByEmail(email);
      if (!user) throw error;
    }
  } else if (isSuperAdmin && (user.role !== "SUPER_ADMIN" || user.approval !== "APPROVED" || !user.isActive)) {
    // A configured Super Admin can never be locked out, whatever happened to their account.
    // Someone others depend on (a department's manager, or anyone with direct reports) keeps
    // their role until those are moved, and is still let in.
    const promote = user.role !== "SUPER_ADMIN" && !(await othersDependOn(user.id));
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        approval: "APPROVED",
        isActive: true,
        ...(promote ? { role: "SUPER_ADMIN" as const, departmentId: null, reportsTo: null } : {}),
      },
    });
    if (promote) await prisma.projectMember.deleteMany({ where: { userId: user.id } });
  }

  // There is always an IT department, led by a Super Admin.
  if (isSuperAdmin) await ensureItDepartment(user);

  const outcome: SignInOutcome = !user.isActive
    ? "inactive"
    : user.approval === "PENDING"
      ? "pending"
      : user.approval === "REJECTED"
        ? "rejected"
        : "signed-in";
  return { user, outcome };
}

/**
 * Lets a waiting (or previously rejected) person in, with their role and place in the org. A
 * Manager can be given a department in the same step: they become its manager.
 */
export async function approveUser(actor: Actor, id: string, input: ApproveUserInput) {
  const target = await prisma.user.findUnique({ where: { id }, select: { approval: true } });
  if (!target) throw notFound();
  if (target.approval === "APPROVED") throw conflict("This person is already approved.", "ALREADY_APPROVED");

  let managedDepartment: { id: string; name: string } | null = null;
  if (input.role === "MANAGER" && input.departmentId) {
    const department = await prisma.department.findUnique({
      where: { id: input.departmentId },
      include: { manager: { select: { role: true } } },
    });
    if (!department) throw badRequest("That department doesn't exist.");
    if (department.status !== "Active") throw badRequest("That department is archived.");
    if (department.manager?.role === "SUPER_ADMIN") {
      throw badRequest("This department is led by the Super Admin and has no Manager.");
    }
    managedDepartment = department;
  }

  const user = await updateUser(
    actor,
    id,
    input.role === "TEAM_LEAD" || input.role === "DEVELOPER"
      ? { role: input.role, departmentId: input.departmentId ?? null, reportsTo: input.reportsTo ?? undefined }
      : { role: input.role },
    { approve: true },
  );
  if (managedDepartment) {
    await changeDepartmentManager(actor, managedDepartment.id, { mode: "existing", userId: id });
  }

  if (receivesEmail(user)) {
    const department = managedDepartment
      ? managedDepartment.name
      : user.departmentId
        ? (await prisma.department.findUnique({ where: { id: user.departmentId }, select: { name: true } }))?.name
        : undefined;
    await sendEmailSafely(
      accessApprovedEmail({
        to: user.email,
        name: user.name,
        role: ROLE_LABELS[user.role as Role],
        departmentName: department,
      }),
    );
  }
  return user;
}

/** Turns a waiting person away. They can still be approved later from the Users page. */
export async function rejectUser(actor: Actor, id: string) {
  const target = await prisma.user.findUnique({ where: { id }, select: { approval: true } });
  if (!target) throw notFound();
  if (target.approval !== "PENDING") {
    throw conflict("Only someone waiting for approval can be rejected. Deactivate an approved person instead.");
  }
  const user = await prisma.user.update({ where: { id }, data: { approval: "REJECTED" } });
  await prisma.auditLog.create({
    data: { actorId: actor.id, action: "user.reject", targetType: "User", targetId: id, meta: {} },
  });
  return user;
}
