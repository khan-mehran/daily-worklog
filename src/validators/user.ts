import { z } from "zod";
import { APPROVALS, ROLES, THEMES } from "@/lib/constants";
import { emailSchema, idSchema, paginationSchema, personNameSchema } from "./common";

/** The roles inside departments. Anyone who manages users can give these. */
export const assignableRoleSchema = z.enum(["MANAGER", "TEAM_LEAD", "DEVELOPER"]);
/** Every role. Whether the caller may give Super Admin or CEO is decided in the service. */
export const anyRoleSchema = z.enum(ROLES);

export const createUserSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  role: assignableRoleSchema,
  departmentId: idSchema.nullable().optional(),
  reportsTo: idSchema.nullable().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: personNameSchema,
    role: anyRoleSchema,
    departmentId: idSchema.nullable(),
    reportsTo: idSchema.nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/**
 * Approving someone who signed in with Microsoft: their role and where they sit. A Manager's
 * department is optional, and makes them that department's manager.
 */
export const approveUserSchema = z.object({
  role: anyRoleSchema,
  departmentId: idSchema.nullable().optional(),
  reportsTo: idSchema.nullable().optional(),
});
export type ApproveUserInput = z.infer<typeof approveUserSchema>;

export const listUsersQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(80).optional(),
  role: anyRoleSchema.optional(),
  approval: z.enum(APPROVALS).optional(),
  departmentId: idSchema.optional(),
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

export const departmentFilterSchema = z.object({ departmentId: idSchema.nullable() });

export const updateProfileSchema = z.object({ name: personNameSchema });
