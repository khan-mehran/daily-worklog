import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { Notification } from "@/models";
import { objectIdSchema } from "@/validators/common";

const readSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(objectIdSchema).min(1).max(100) }),
]);

// The recipient filter means nobody can mark someone else's notifications.
export const POST = authedRoute(async ({ req, user }) => {
  const body = await parseBody(req, readSchema);
  const result = await Notification.updateMany(
    { recipientId: user.id, readAt: null, ...("ids" in body ? { _id: { $in: body.ids } } : {}) },
    { readAt: new Date() },
  );
  return NextResponse.json({ data: { updated: result.modifiedCount } });
});
