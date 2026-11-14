import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, parseQuery } from "@/lib/api/handler";
import { serialiseNotification } from "@/lib/notifications/serialise";
import { Notification } from "@/models";
import { paginationSchema } from "@/validators/common";

const querySchema = paginationSchema.extend({ unread: z.enum(["true", "false"]).optional() });

// Always the caller's own notifications.
export const GET = authedRoute(async ({ req, user }) => {
  const { page, limit, unread } = parseQuery(req, querySchema);
  const filter = { recipientId: user.id, ...(unread === "true" ? { readAt: null } : {}) };
  const [rows, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipientId: user.id, readAt: null }),
  ]);
  return NextResponse.json({
    data: rows.map(serialiseNotification),
    meta: { page, limit, total, unread: unreadCount },
  });
});
