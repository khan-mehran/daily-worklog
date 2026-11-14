import { model, models, Schema, type Model, type Types } from "mongoose";

export interface IAuditLog {
  _id: Types.ObjectId;
  actorId: Types.ObjectId;
  action: string;
  targetType: "User" | "Department" | "Project";
  targetId: Types.ObjectId;
  meta: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    targetType: { type: String, enum: ["User", "Department", "Project"], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export const AuditLog =
  (models.AuditLog as Model<IAuditLog>) || model<IAuditLog>("AuditLog", auditLogSchema);
