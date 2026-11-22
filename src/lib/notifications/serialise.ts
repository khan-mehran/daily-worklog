import type { Notification } from "@prisma/client";

export function serialiseNotification(notification: Notification) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    link: notification.link,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

export type NotificationRow = ReturnType<typeof serialiseNotification>;
