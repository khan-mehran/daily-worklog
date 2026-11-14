import { model, models, Schema, type Model, type Types } from "mongoose";
import { REPORT_STATUSES, type ReportStatus } from "@/lib/constants";

export const TRAIL_ACTIONS = [
  "SUBMITTED",
  "LEAD_APPROVED",
  "MANAGER_APPROVED",
  "CEO_ACKNOWLEDGED",
  "CHANGES_REQUESTED",
] as const;
export type TrailAction = (typeof TRAIL_ACTIONS)[number];

export interface ITrailEntry {
  action: TrailAction;
  byUserId: Types.ObjectId;
  at: Date;
  comment: string | null;
}

export interface IReportTotals {
  hours: number;
  taskCount: number;
  completedCount: number;
  blockedCount: number;
  byProject: { projectId: Types.ObjectId; hours: number; taskCount: number }[];
}

export interface IWeeklyReport {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  departmentId: Types.ObjectId;
  isoYear: number;
  isoWeek: number;
  weekStart: Date;
  weekEnd: Date;
  status: ReportStatus;
  currentApproverId: Types.ObjectId | null;
  submittedAt: Date | null;
  leadApprovedAt: Date | null;
  managerApprovedAt: Date | null;
  approvalTrail: ITrailEntry[];
  totals: IReportTotals;
  createdAt: Date;
  updatedAt: Date;
}

const weeklyReportSchema = new Schema<IWeeklyReport>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", required: true },
    isoYear: { type: Number, required: true },
    isoWeek: { type: Number, required: true },
    weekStart: { type: Date, required: true },
    weekEnd: { type: Date, required: true },
    status: { type: String, enum: REPORT_STATUSES, default: "DRAFT" },
    currentApproverId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    submittedAt: { type: Date, default: null },
    leadApprovedAt: { type: Date, default: null },
    managerApprovedAt: { type: Date, default: null },
    approvalTrail: [
      {
        _id: false,
        action: { type: String, enum: TRAIL_ACTIONS, required: true },
        byUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        at: { type: Date, required: true },
        comment: { type: String, default: null },
      },
    ],
    totals: {
      hours: { type: Number, default: 0 },
      taskCount: { type: Number, default: 0 },
      completedCount: { type: Number, default: 0 },
      blockedCount: { type: Number, default: 0 },
      byProject: [
        {
          _id: false,
          projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
          hours: { type: Number, default: 0 },
          taskCount: { type: Number, default: 0 },
        },
      ],
    },
  },
  { timestamps: true },
);

weeklyReportSchema.index({ userId: 1, isoYear: 1, isoWeek: 1 }, { unique: true });
weeklyReportSchema.index({ departmentId: 1, status: 1, weekStart: 1 });
weeklyReportSchema.index({ currentApproverId: 1, status: 1 });
weeklyReportSchema.index({ "totals.byProject.projectId": 1, weekStart: -1 });

export const WeeklyReport =
  (models.WeeklyReport as Model<IWeeklyReport>) ||
  model<IWeeklyReport>("WeeklyReport", weeklyReportSchema);
