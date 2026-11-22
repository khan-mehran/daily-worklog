import type { Prisma } from "@prisma/client";
import type { PaletteColor } from "@/lib/constants";

export const USER_INCLUDE = {
  department: { select: { id: true, name: true, code: true, color: true } },
  approver: { select: { id: true, name: true, role: true } },
} satisfies Prisma.UserInclude;

type UserRecord = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

/** Lists only the fields the client needs, so a new column is never exposed by default. */
export function serialiseUser(user: UserRecord) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarColor: user.avatarColor as PaletteColor,
    isActive: user.isActive,
    approval: user.approval,
    department: user.department
      ? {
          id: user.department.id,
          name: user.department.name,
          code: user.department.code,
          color: user.department.color as PaletteColor,
        }
      : null,
    reportsTo: user.approver
      ? { id: user.approver.id, name: user.approver.name, role: user.approver.role }
      : null,
  };
}

export type UserRow = ReturnType<typeof serialiseUser>;
