import { model, models, Schema, type Model, type Types } from "mongoose";
import {
  REPORT_STATUSES,
  SYNC_ORIGINS,
  TASK_SOURCES,
  type SyncOrigin,
  TASK_STATUSES,
  type ReportStatus,
  type TaskSource,
  type TaskStatus,
} from "@/lib/constants";

export interface ITask {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  departmentId: Types.ObjectId;
  projectId: Types.ObjectId;
  /** The calendar day, stored as midnight UTC. */
  date: Date;
  details: string;
  hours: number | null;
  status: TaskStatus;
  weeklyReportId: Types.ObjectId;
  /**
   * A copy of the weekly report's status, kept in step by the workflow. It lets the approval gate
   * apply to task queries with a single indexed filter instead of a join.
   */
  reportStatus: ReportStatus;
  /** "sync" for tasks written by the VS Code daily sync, "manual" for everything else. */
  source: TaskSource;
  /**
   * For synced tasks, a hash of the details the sync last wrote. When the details no longer match
   * it, the person has edited the task, and later syncs leave it alone.
   */
  syncHash: string | null;
  /**
   * What the last sync wrote from: "items" for a finished list from the /worklog command,
   * "activity" for commits summarised by the server. Activity never replaces a list.
   */
  syncedFrom: SyncOrigin | null;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    date: { type: Date, required: true },
    details: { type: String, required: true, trim: true },
    hours: { type: Number, min: 0, max: 24, default: null },
    status: { type: String, enum: TASK_STATUSES, default: "Completed" },
    weeklyReportId: { type: Schema.Types.ObjectId, ref: "WeeklyReport", required: true },
    reportStatus: { type: String, enum: REPORT_STATUSES, default: "DRAFT" },
    source: { type: String, enum: TASK_SOURCES, default: "manual" },
    syncHash: { type: String, default: null },
    syncedFrom: { type: String, enum: [...SYNC_ORIGINS, null], default: null },
  },
  { timestamps: true },
);

taskSchema.index({ departmentId: 1, date: 1 });
taskSchema.index({ userId: 1, date: 1 });
taskSchema.index({ projectId: 1, date: 1 });
taskSchema.index({ weeklyReportId: 1 });
taskSchema.index({ departmentId: 1, reportStatus: 1, date: 1 });
// One synced task per person, project and day.
taskSchema.index(
  { userId: 1, projectId: 1, date: 1 },
  { unique: true, partialFilterExpression: { source: "sync" } },
);

export const Task = (models.Task as Model<ITask>) || model<ITask>("Task", taskSchema);
