import { z } from "zod";

export const approvalSettingsSchema = z.object({ teamLeadReview: z.boolean() });

/** Changed environment settings by name. Which names are allowed is checked against ENV_FIELDS. */
export const envPatchSchema = z.object({
  values: z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string().max(2000)),
});
