import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";
import { idSchema } from "@/validators/common";

const readSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(idSchema).min(1).max(100) }),
]);

// The recipient filter means nobody can mark someone else's notifications.
export const POST = authedRoute(async ({ req, user }) => {
  const body = await parseBody(req, readSchema);
  const result = await prisma.notification.updateMany({
    where: { recipientId: user.id, readAt: null, ...("ids" in body ? { id: { in: body.ids } } : {}) },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ data: { updated: result.count } });
});
