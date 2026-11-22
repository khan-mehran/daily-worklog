import { z } from "zod";
import { PROJECT_STATUSES } from "@/lib/constants";
import { daySchema, idSchema, paginationSchema, paletteColorSchema } from "./common";

const name = z.string({ error: "Enter a project name" }).trim().min(2, "Enter a project name").max(80);
const code = z
  .string({ error: "Use 2 to 10 letters or digits" })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, "Use 2 to 10 letters or digits");
const description = z.string().trim().max(1000);
const status = z.enum(PROJECT_STATUSES);

/** A yyyy-mm-dd day. An empty date input and null both mean no date. */
const optionalDay = z
  .union([
    daySchema,
    z.literal(""),
    z.null(),
  ])
  .transform((value) => value || null);

const endsAfterStart = (
  value: { startDate?: string | null; endDate?: string | null },
  context: z.RefinementCtx,
) => {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "The end date can't be before the start date",
    });
  }
};

// There is deliberately no departmentId here. A project's department comes from its creator.
export const createProjectSchema = z
  .object({
    name,
    code,
    description: description.default(""),
    color: paletteColorSchema,
    status: status.default("Active"),
    startDate: optionalDay.optional(),
    endDate: optionalDay.optional(),
    memberIds: z.array(idSchema).max(200).default([]),
  })
  .superRefine(endsAfterStart);
export type CreateProjectInput = z.output<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({ name, code, description, color: paletteColorSchema, status, startDate: optionalDay, endDate: optionalDay })
  .partial()
  .superRefine(endsAfterStart)
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateProjectInput = z.output<typeof updateProjectSchema>;

export const updateMembersSchema = z
  .object({
    add: z.array(idSchema).max(200).default([]),
    remove: z.array(idSchema).max(200).default([]),
  })
  .refine((value) => value.add.length + value.remove.length > 0, "Nothing to update");
export type UpdateMembersInput = z.output<typeof updateMembersSchema>;

export const listProjectsQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(80).optional(),
  status: status.optional(),
  departmentId: idSchema.optional(),
});
export type ListProjectsQuery = z.output<typeof listProjectsQuerySchema>;
