import { z } from "zod";
import { paginationSchema } from "./common";

export const requestChangesSchema = z.object({
  comment: z
    .string({ error: "Say what needs to change" })
    .trim()
    .min(3, "Say what needs to change")
    .max(1000),
});

export const myReportsQuerySchema = paginationSchema.extend({
  limit: z.coerce.number().int().min(1).max(12).default(4),
});

export const reviewQueueQuerySchema = paginationSchema;
