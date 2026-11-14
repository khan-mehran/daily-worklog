import { NextResponse } from "next/server";
import { forbidden } from "@/lib/api/errors";
import { authedRoute, parseBody, parseQuery } from "@/lib/api/handler";
import { canManageUsers, canViewPeople, isCEO, scopeFor } from "@/lib/permissions";
import { serialiseUser, USER_POPULATE } from "@/lib/users/serialise";
import { createUser } from "@/lib/users/service";
import { escapeRegex } from "@/lib/utils";
import { User } from "@/models";
import { createUserSchema, listUsersQuerySchema } from "@/validators/user";

export const GET = authedRoute(async ({ req, user, selectedDepartmentId }) => {
  if (!canViewPeople(user)) throw forbidden();
  const query = parseQuery(req, listUsersQuerySchema);

  // scopeFor ignores the requested department for everyone but the CEO.
  const departmentFilter =
    isCEO(user) && query.unassigned === "true"
      ? { departmentId: null, role: "MANAGER" }
      : scopeFor(user, query.departmentId ?? selectedDepartmentId);

  const filter = {
    ...(query.role ? { role: query.role } : {}),
    ...departmentFilter,
    ...(query.active ? { isActive: query.active === "true" } : {}),
    ...(query.search
      ? {
          $or: [
            { name: { $regex: escapeRegex(query.search), $options: "i" } },
            { email: { $regex: escapeRegex(query.search), $options: "i" } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ name: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .populate(USER_POPULATE)
      .lean(),
    User.countDocuments(filter),
  ]);
  return NextResponse.json({
    data: users.map(serialiseUser),
    meta: { page: query.page, limit: query.limit, total },
  });
});

export const POST = authedRoute(async ({ req, user }) => {
  if (!canManageUsers(user)) throw forbidden();
  const created = await createUser(user, await parseBody(req, createUserSchema));
  return NextResponse.json({ data: { id: String(created._id) } }, { status: 201 });
});
