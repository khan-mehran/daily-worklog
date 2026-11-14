import { NextResponse } from "next/server";
import { conflict, forbidden, notFound } from "@/lib/api/errors";
import { authedRoute, objectIdParam } from "@/lib/api/handler";
import { sendEmailSafely } from "@/lib/email";
import { inviteEmail } from "@/lib/email/templates";
import { canManageUsers, departmentCollectionScope } from "@/lib/permissions";
import { newInvite } from "@/lib/users/service";
import { User } from "@/models";

export const POST = authedRoute<{ id: string }>(async ({ params, user }) => {
  const scope = departmentCollectionScope(user);
  const target = await User.findOne({
    _id: objectIdParam(params.id),
    ...(scope._id ? { departmentId: scope._id } : {}),
  }).select("+passwordHash");
  if (!target) throw notFound();
  if (!canManageUsers(user)) throw forbidden();
  if (target.passwordHash) throw conflict("This person has already set a password.");

  const { token, inviteTokenHash, inviteExpiresAt } = newInvite();
  target.set({ inviteTokenHash, inviteExpiresAt });
  await target.save();
  const sent = await sendEmailSafely(inviteEmail({ to: target.email, name: target.name, token }));
  return NextResponse.json({ data: { sent } });
});
