import { model, models, Schema, type Model, type Types } from "mongoose";

export const NOTIFICATION_TYPES = [
  "DEPARTMENT_ASSIGNED",
  "DEPARTMENT_UNASSIGNED",
  "REPORT_SUBMITTED",
  "REPORT_APPROVED",
  "REPORT_ACKNOWLEDGED",
  "REPORT_CHANGES_REQUESTED",
  "REMINDER",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface INotification {
  _id: Types.ObjectId;
  recipientId: Types.ObjectId;
  departmentId: Types.ObjectId | null;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  reportId: Types.ObjectId | null;
  readAt: Date | null;
  /** Set on reminders, so the same reminder is never sent twice. */
  dedupeKey: string | null;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    recipientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String, default: null },
    reportId: { type: Schema.Types.ObjectId, ref: "WeeklyReport", default: null },
    readAt: { type: Date, default: null },
    dedupeKey: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ departmentId: 1, createdAt: -1 });
notificationSchema.index(
  { recipientId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);

export const Notification =
  (models.Notification as Model<INotification>) ||
  model<INotification>("Notification", notificationSchema);
