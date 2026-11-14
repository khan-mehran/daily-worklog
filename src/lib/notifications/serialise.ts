import type { INotification } from "@/models";

export function serialiseNotification(notification: INotification) {
  return {
    id: String(notification._id),
    type: notification.type,
    title: notification.title,
    message: notification.message,
    link: notification.link,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

export type NotificationRow = ReturnType<typeof serialiseNotification>;
