import type { NotificationType } from "@prisma/client";
import { isUniqueViolation, prisma } from "@/lib/db/prisma";
import { sendEmailSafely } from "@/lib/email";
import { notificationEmail } from "@/lib/email/templates";

export type { NotificationType };

interface NotificationInput {
  recipientId: string;
  departmentId: string | null;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  reportId?: string;
  /** A reminder with the same key is never sent to the same person twice. */
  dedupeKey?: string;
}

export async function createNotification(input: NotificationInput) {
  await prisma.notification.create({ data: input });
}

/**
 * The CEO (the chairman) follows everything in the app and is never emailed, whatever their
 * preferences say. Everyone else gets email unless they've turned it off.
 */
export const receivesEmail = (person: { role: string; emailNotifications: boolean }) =>
  person.role !== "CEO" && person.emailNotifications;

/**
 * Notifies one person in the app and, if `email` is set, by email, following their preferences.
 * Returns false when nothing was sent: an inactive user, or a reminder they already received.
 */
export async function notify(input: NotificationInput & { email?: boolean }) {
  const { email, ...notification } = input;
  const recipient = await prisma.user.findUnique({
    where: { id: input.recipientId },
    select: {
      name: true,
      email: true,
      role: true,
      isActive: true,
      emailNotifications: true,
      inAppNotifications: true,
    },
  });
  if (!recipient?.isActive) return false;

  // A deduplicated reminder is always stored, because the stored row is what prevents a repeat.
  if (recipient.inAppNotifications || input.dedupeKey) {
    try {
      await prisma.notification.create({ data: notification });
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }
  if (email && receivesEmail(recipient)) {
    await sendEmailSafely(
      notificationEmail({
        to: recipient.email,
        name: recipient.name,
        title: input.title,
        message: input.message,
        link: input.link ?? null,
      }),
    );
  }
  return true;
}

export const countUnreadNotifications = (recipientId: string) =>
  prisma.notification.count({ where: { recipientId, readAt: null } });
