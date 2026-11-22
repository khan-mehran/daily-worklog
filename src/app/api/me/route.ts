import { NextResponse } from "next/server";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { updateProfileSchema } from "@/validators/user";

export const GET = authedRoute(async ({ user }) => NextResponse.json({ data: user }));

export const PATCH = authedRoute(async ({ req, user }) => {
  const { name } = await parseBody(req, updateProfileSchema);
  await prisma.user.update({ where: { id: user.id }, data: { name } });
  return NextResponse.json({ data: { name } });
});
