import { z } from "zod";
import { THEMES } from "@/lib/constants";
import { emailSchema, objectIdSchema, paginationSchema, passwordSchema, personNameSchema } from "./common";

/** CEO is deliberately absent: there is one, and it's created by the seed. */
export const assignableRoleSchema = z.enum(["MANAGER", "TEAM_LEAD", "DEVELOPER"]);

export const createUserSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  role: assignableRoleSchema,
  departmentId: objectIdSchema.nullable().optional(),
  reportsTo: objectIdSchema.nullable().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: personNameSchema,
    role: assignableRoleSchema,
    departmentId: objectIdSchema.nullable(),
    reportsTo: objectIdSchema.nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const listUsersQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(80).optional(),
  role: z.enum(["CEO", "MANAGER", "TEAM_LEAD", "DEVELOPER"]).optional(),
  departmentId: objectIdSchema.optional(),
  /** Managers with no department yet, for the Assign manager picker. */
  unassigned: z.enum(["true", "false"]).optional(),
  active: z.enum(["true", "false"]).optional(),
});

export const preferencesSchema = z
  .object({
    theme: z.enum(THEMES),
    emailNotifications: z.boolean(),
    inAppNotifications: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

export const departmentFilterSchema = z.object({ departmentId: objectIdSchema.nullable() });

export const updateProfileSchema = z.object({ name: personNameSchema });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(72),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password you haven't used here",
  });
