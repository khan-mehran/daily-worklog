import { NextResponse } from "next/server";
import { forbidden, notFound } from "@/lib/api/errors";
import { authedRoute, idParam, parseBody } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { canManageUsers, scopeFor } from "@/lib/permissions";
import { approveUser } from "@/lib/users/access";
import { approveUserSchema } from "@/validators/user";

// Lets in someone who signed in with Microsoft and is waiting, with their role and department.
export const POST = authedRoute<{ id: string }>(async ({ req, params, user }) => {
  const id = idParam(params.id);
  // Checked in this order so someone outside the caller's department is a 404, not a 403. People
  // waiting belong to no department yet, so only those who manage users can find them at all.
  const target = await prisma.user.findFirst({ where: { id, ...scopeFor(user) }, select: { id: true } });
  if (!target) throw notFound();
  if (!canManageUsers(user)) throw forbidden();
  const approved = await approveUser(user, id, await parseBody(req, approveUserSchema));
  return NextResponse.json({ data: { id: approved.id, approval: approved.approval, role: approved.role } });
});
