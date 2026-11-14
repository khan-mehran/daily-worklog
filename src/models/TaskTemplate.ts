import { model, models, Schema, type Model, type Types } from "mongoose";

export interface ITaskTemplate {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  departmentId: Types.ObjectId;
  projectId: Types.ObjectId;
  details: string;
  hours: number | null;
  createdAt: Date;
}

const taskTemplateSchema = new Schema<ITaskTemplate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    details: { type: String, required: true, trim: true },
    hours: { type: Number, min: 0, max: 24, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

taskTemplateSchema.index({ userId: 1, createdAt: -1 });

export const TaskTemplate =
  (models.TaskTemplate as Model<ITaskTemplate>) ||
  model<ITaskTemplate>("TaskTemplate", taskTemplateSchema);
