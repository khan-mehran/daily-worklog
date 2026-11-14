import { model, models, Schema, type Model, type Types } from "mongoose";
import { PALETTE, ROLES, THEMES, type PaletteColor, type Role, type ThemePreference } from "@/lib/constants";

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string | null;
  role: Role;
  reportsTo: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
  avatarColor: PaletteColor;
  isActive: boolean;
  inviteTokenHash: string | null;
  inviteExpiresAt: Date | null;
  preferences: {
    theme: ThemePreference;
    emailNotifications: boolean;
    inAppNotifications: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Null until the user accepts their invite. Secrets are never selected by default.
    passwordHash: { type: String, default: null, select: false },
    role: { type: String, enum: ROLES, required: true },
    reportsTo: { type: Schema.Types.ObjectId, ref: "User", default: null },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    avatarColor: { type: String, enum: PALETTE, default: "teal" },
    isActive: { type: Boolean, default: true },
    inviteTokenHash: { type: String, default: null, select: false },
    inviteExpiresAt: { type: Date, default: null, select: false },
    preferences: {
      theme: { type: String, enum: THEMES, default: "system" },
      emailNotifications: { type: Boolean, default: true },
      inAppNotifications: { type: Boolean, default: true },
    },
  },
  { timestamps: true },
);

userSchema.index({ departmentId: 1, role: 1 });
userSchema.index({ reportsTo: 1 });
userSchema.index({ inviteTokenHash: 1 }, { sparse: true });

export const User = (models.User as Model<IUser>) || model<IUser>("User", userSchema);
