import type { Types } from "mongoose";
import { sendEmailSafely } from "@/lib/email";
import { notificationEmail } from "@/lib/email/templates";
import { Notification, User, type NotificationType } from "@/models";

interface NotificationInput {
  recipientId: Types.ObjectId | string;
  departmentId: Types.ObjectId | string | null;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  reportId?: Types.ObjectId;
  /** A reminder with the same key is never sent to the same person twice. */
  dedupeKey?: string;
}

export async function createNotification(input: NotificationInput) {
  await Notification.create(input);
}

/**
 * Notifies one person in the app and, if `email` is set, by email, following their preferences.
 * Returns false when nothing was sent: an inactive user, or a reminder they already received.
 */
export async function notify(input: NotificationInput & { email?: boolean }) {
  const { email, ...notification } = input;
  const recipient = await User.findById(input.recipientId)
    .select("name email isActive preferences")
    .lean();
  if (!recipient?.isActive) return false;

  // A deduplicated reminder is always stored, because the stored row is what prevents a repeat.
  if (recipient.preferences.inAppNotifications || input.dedupeKey) {
    try {
      await Notification.create(notification);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return false;
      throw error;
    }
  }
  if (email && recipient.preferences.emailNotifications) {
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
  Notification.countDocuments({ recipientId, readAt: null });
