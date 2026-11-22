import { NextResponse } from "next/server";
import { forbidden, notFound } from "@/lib/api/errors";
import { authedRoute, idParam, parseBody } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { canManageUsers, canViewUser, scopeFor } from "@/lib/permissions";
import { serialiseUser, USER_INCLUDE } from "@/lib/users/serialise";
import { updateUser } from "@/lib/users/service";
import { updateUserSchema } from "@/validators/user";

type Params = { id: string };

export const GET = authedRoute<Params>(async ({ params, user }) => {
  const id = idParam(params.id);
  const target = await prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
  if (!target || !canViewUser(user, target)) throw notFound();
  return NextResponse.json({ data: serialiseUser(target) });
});

export const PATCH = authedRoute<Params>(async ({ req, params, user }) => {
  const id = idParam(params.id);
  // Checked in this order so another department's user is a 404, not a 403.
  const target = await prisma.user.findFirst({ where: { id, ...scopeFor(user) }, select: { id: true } });
  if (!target) throw notFound();
  if (!canManageUsers(user)) throw forbidden();

  const updated = await updateUser(user, id, await parseBody(req, updateUserSchema));
  return NextResponse.json({ data: { id: updated.id } });
});
