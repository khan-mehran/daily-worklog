import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";

/** Records that the one-time VS Code sync setup popup has been shown, so it isn't shown again. */
export const POST = authedRoute(async ({ user }) => {
  await prisma.user.updateMany({
    where: { id: user.id, syncGuideSeenAt: null },
    data: { syncGuideSeenAt: new Date() },
  });
  return NextResponse.json({ data: { seen: true } });
});
