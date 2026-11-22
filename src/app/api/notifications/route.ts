import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, parseQuery } from "@/lib/api/handler";
import { serialiseNotification } from "@/lib/notifications/serialise";
import { prisma } from "@/lib/db/prisma";
import { paginationSchema } from "@/validators/common";

const querySchema = paginationSchema.extend({ unread: z.enum(["true", "false"]).optional() });

// Always the caller's own notifications.
export const GET = authedRoute(async ({ req, user }) => {
  const { page, limit, unread } = parseQuery(req, querySchema);
  const where = { recipientId: user.id, ...(unread === "true" ? { readAt: null } : {}) };
  const [rows, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { recipientId: user.id, readAt: null } }),
  ]);
  return NextResponse.json({
    data: rows.map(serialiseNotification),
    meta: { page, limit, total, unread: unreadCount },
  });
});
