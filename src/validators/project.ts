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

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;

/**
 * "workspace/repo", or "workspace/repo/folder" when package-lock.json isn't at the top. A pasted
 * Bitbucket address becomes "workspace/repo". Returns null for anything else.
 */
export function normaliseRepository(input: string) {
  let value = input.trim();
  const address = /^(?:https?:\/\/(?:[^@/]+@)?bitbucket\.org\/|git@bitbucket\.org:)([^/\s]+)\/([^/\s]+)/i.exec(value);
  if (address) value = `${address[1]}/${address[2]}`;
  value = value.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  return REPOSITORY.test(value) && !value.split("/").some((part) => /^\.+$/.test(part)) ? value : null;
}

/** The Bitbucket repository the dependency audit reads. Empty and null both mean none. */
const repository = z
  .union([z.string().trim().max(200), z.null()])
  .transform((value, context) => {
    if (!value) return null;
    const normalised = normaliseRepository(value);
    if (!normalised) {
      context.addIssue({ code: "custom", message: "Use workspace/repository, as in the Bitbucket address" });
      return z.NEVER;
    }
    return normalised;
  });

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
    repository: repository.optional(),
    memberIds: z.array(idSchema).max(200).default([]),
  })
  .superRefine(endsAfterStart);
export type CreateProjectInput = z.output<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({ name, code, description, color: paletteColorSchema, status, startDate: optionalDay, endDate: optionalDay, repository })
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
