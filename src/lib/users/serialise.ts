import type { PopulateOptions, Types } from "mongoose";
import type { IUser } from "@/models";

export const USER_POPULATE: PopulateOptions[] = [
  { path: "departmentId", select: "name code color" },
  { path: "reportsTo", select: "name role" },
];

type PopulatedUser = Pick<IUser, "name" | "email" | "role" | "avatarColor" | "isActive"> & {
  _id: Types.ObjectId;
  departmentId: unknown;
  reportsTo: unknown;
};

/** Lists only the fields the client needs, so a new schema field is never exposed by default. */
export function serialiseUser(user: PopulatedUser) {
  const department = user.departmentId as {
    _id: Types.ObjectId;
    name: string;
    code: string;
    color: string;
  } | null;
  const manager = user.reportsTo as { _id: Types.ObjectId; name: string; role: string } | null;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    avatarColor: user.avatarColor,
    isActive: user.isActive,
    department: department
      ? {
          id: String(department._id),
          name: department.name,
          code: department.code,
          color: department.color,
        }
      : null,
    reportsTo: manager ? { id: String(manager._id), name: manager.name, role: manager.role } : null,
  };
}

export type UserRow = ReturnType<typeof serialiseUser>;
