import { NextResponse } from "next/server";
import { forbidden, notFound } from "@/lib/api/errors";
import { authedRoute, objectIdParam, parseBody } from "@/lib/api/handler";
import { canManageUsers, canViewUser, departmentCollectionScope } from "@/lib/permissions";
import { serialiseUser, USER_POPULATE } from "@/lib/users/serialise";
import { updateUser } from "@/lib/users/service";
import { User } from "@/models";
import { updateUserSchema } from "@/validators/user";

type Params = { id: string };

export const GET = authedRoute<Params>(async ({ params, user }) => {
  const id = objectIdParam(params.id);
  const target = await User.findById(id).select("departmentId").lean();
  if (!target || !canViewUser(user, target)) throw notFound();
  const populated = await User.findById(id).populate(USER_POPULATE).lean();
  if (!populated) throw notFound();
  return NextResponse.json({ data: serialiseUser(populated) });
});

export const PATCH = authedRoute<Params>(async ({ req, params, user }) => {
  const id = objectIdParam(params.id);
  // Checked in this order so another department's user is a 404, not a 403.
  const scope = departmentCollectionScope(user);
  const target = await User.findOne({
    _id: id,
    ...(scope._id ? { departmentId: scope._id } : {}),
  })
    .select("_id")
    .lean();
  if (!target) throw notFound();
  if (!canManageUsers(user)) throw forbidden();

  const updated = await updateUser(user, id, await parseBody(req, updateUserSchema));
  return NextResponse.json({ data: { id: String(updated._id) } });
});
