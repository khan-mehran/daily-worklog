import { NextResponse } from "next/server";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { preferencesSchema } from "@/validators/user";

export const PATCH = authedRoute(async ({ req, user }) => {
  const patch = await parseBody(req, preferencesSchema);
  const select = { theme: true, emailNotifications: true, inAppNotifications: true } as const;
  const updated = await prisma.user.update({ where: { id: user.id }, data: patch, select });
  return NextResponse.json({ data: updated });
});
