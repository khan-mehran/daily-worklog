import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { forbidden } from "@/lib/api/errors";
import { authedRoute, parseBody, parseQuery } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { canManageUsers, canViewPeople, isOrgWide, scopeFor } from "@/lib/permissions";
import { serialiseUser, USER_INCLUDE } from "@/lib/users/serialise";
import { createUser } from "@/lib/users/service";
import { createUserSchema, listUsersQuerySchema } from "@/validators/user";

export const GET = authedRoute(async ({ req, user, selectedDepartmentId }) => {
  if (!canViewPeople(user)) throw forbidden();
  const query = parseQuery(req, listUsersQuerySchema);

  // scopeFor ignores the requested department for everyone but the CEO.
  const departmentFilter: Prisma.UserWhereInput =
    isOrgWide(user) && query.unassigned === "true"
      ? { departmentId: null, role: "MANAGER", approval: "APPROVED" }
      : scopeFor(user, query.departmentId ?? selectedDepartmentId);

  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...departmentFilter,
    ...(query.active ? { isActive: query.active === "true" } : {}),
    // Only the people who manage users see who is waiting or was turned away.
    ...(canManageUsers(user) ? (query.approval ? { approval: query.approval } : {}) : { approval: "APPROVED" as const }),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      // PENDING sorts first, so people waiting are at the top.
      orderBy: [{ approval: "asc" }, { name: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: USER_INCLUDE,
    }),
    prisma.user.count({ where }),
  ]);
  return NextResponse.json({
    data: users.map(serialiseUser),
    meta: { page: query.page, limit: query.limit, total },
  });
});

export const POST = authedRoute(async ({ req, user }) => {
  if (!canManageUsers(user)) throw forbidden();
  const created = await createUser(user, await parseBody(req, createUserSchema));
  return NextResponse.json({ data: { id: created.id } }, { status: 201 });
});
