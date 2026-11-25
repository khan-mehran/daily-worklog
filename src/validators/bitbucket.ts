import { z } from "zod";

/** Empty and null both mean none. */
const optional = (schema: z.ZodString) =>
  z.union([schema, z.literal(""), z.null()]).transform((value) => value || null);

export const bitbucketConnectionSchema = z.object({
  username: optional(z.string().trim().max(200).regex(/^[^\s:]+$/, "A username has no spaces or colons")).optional(),
  /** Left empty when a token is already saved, it keeps that one. */
  token: optional(z.string().trim().max(1000).regex(/^\S+$/, "A token has no spaces")).optional(),
  /** One workspace ID or several, separated by commas. Saved as "a, b". */
  workspace: z
    .union([
      z
        .string()
        .trim()
        .max(500)
        .regex(/^[A-Za-z0-9_.-]+(\s*,\s*[A-Za-z0-9_.-]+)*,?$/, "Use workspace IDs, as in the Bitbucket address, separated by commas"),
      z.literal(""),
      z.null(),
    ])
    .transform((value) => (value ? [...new Set(value.split(/[\s,]+/).filter(Boolean))].join(", ") : null))
    .optional(),
});
export type BitbucketConnectionInput = z.output<typeof bitbucketConnectionSchema>;
