import { model, models, Schema, type Model, type Types } from "mongoose";
import { DEPARTMENT_STATUSES, PALETTE, type DepartmentStatus, type PaletteColor } from "@/lib/constants";

export interface IDepartment {
  _id: Types.ObjectId;
  name: string;
  code: string;
  description: string;
  color: PaletteColor;
  managerId: Types.ObjectId | null;
  status: DepartmentStatus;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const caseInsensitive = { locale: "en", strength: 2 };

const departmentSchema = new Schema<IDepartment>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, default: "", trim: true },
    color: { type: String, enum: PALETTE, required: true },
    managerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: DEPARTMENT_STATUSES, default: "Active" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

departmentSchema.index({ name: 1 }, { unique: true, collation: caseInsensitive });
departmentSchema.index({ code: 1 }, { unique: true });
// One manager per department, enforced by the database as well as the service layer.
departmentSchema.index(
  { managerId: 1 },
  { unique: true, partialFilterExpression: { managerId: { $type: "objectId" } } },
);
departmentSchema.index({ status: 1, name: 1 });

export const Department =
  (models.Department as Model<IDepartment>) || model<IDepartment>("Department", departmentSchema);
