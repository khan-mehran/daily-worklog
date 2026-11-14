import { z } from "zod";
import { PALETTE } from "@/lib/constants";

// Client-safe: ids are checked by shape, with no dependency on the mongoose bundle.
export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const isRealDay = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
};

/** A calendar day as yyyy-mm-dd. */
export const daySchema = z
  .string({ error: "Enter a valid date" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
  .refine(isRealDay, "Enter a valid date");

export const paletteColorSchema = z.enum(PALETTE);

export const emailSchema = z
  .string({ error: "Enter a valid email address" })
  .trim()
  .toLowerCase()
  .email("Enter a valid email address");
export const personNameSchema = z
  .string({ error: "Enter a name" })
  .trim()
  .min(2, "Enter a name")
  .max(80);
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(72, "Use at most 72 characters");
