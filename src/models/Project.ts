import { model, models, Schema, type Model, type Types } from "mongoose";
import { PALETTE, PROJECT_STATUSES, type PaletteColor, type ProjectStatus } from "@/lib/constants";

export interface IProject {
  _id: Types.ObjectId;
  departmentId: Types.ObjectId;
  name: string;
  code: string;
  description: string;
  color: PaletteColor;
  status: ProjectStatus;
  startDate: Date | null;
  endDate: Date | null;
  ownerId: Types.ObjectId;
  memberIds: Types.ObjectId[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProject>(
  {
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, default: "", trim: true },
    color: { type: String, enum: PALETTE, required: true },
    status: { type: String, enum: PROJECT_STATUSES, default: "Active" },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    memberIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

projectSchema.index({ departmentId: 1, status: 1 });
projectSchema.index({ departmentId: 1, code: 1 }, { unique: true });
projectSchema.index({ memberIds: 1 });

export const Project = (models.Project as Model<IProject>) || model<IProject>("Project", projectSchema);
