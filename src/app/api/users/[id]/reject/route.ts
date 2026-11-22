import { NextResponse } from "next/server";
import { forbidden, notFound } from "@/lib/api/errors";
import { authedRoute, idParam } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { canManageUsers, scopeFor } from "@/lib/permissions";
import { rejectUser } from "@/lib/users/access";

// Turns away someone who signed in with Microsoft and is waiting for approval.
export const POST = authedRoute<{ id: string }>(async ({ params, user }) => {
  const id = idParam(params.id);
  // Checked in this order so someone outside the caller's department is a 404, not a 403. People
  // waiting belong to no department yet, so only those who manage users can find them at all.
  const target = await prisma.user.findFirst({ where: { id, ...scopeFor(user) }, select: { id: true } });
  if (!target) throw notFound();
  if (!canManageUsers(user)) throw forbidden();
  const rejected = await rejectUser(user, id);
  return NextResponse.json({ data: { id: rejected.id, approval: rejected.approval } });
});
