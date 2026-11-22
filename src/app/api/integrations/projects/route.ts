import { NextResponse } from "next/server";
import { tokenRoute } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { projectScope } from "@/lib/permissions";
import { requireLogger } from "@/lib/tasks/service";

/**
 * The projects the token's owner can log work on. The sync script's --setup uses it to check its
 * token and to work out which project a repo belongs to.
 */
export const GET = tokenRoute(async ({ user }) => {
  requireLogger(user);
  const projects = await prisma.project.findMany({
    where: { ...projectScope(user), status: { not: "Completed" } },
    select: { code: true, name: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ data: projects });
});
