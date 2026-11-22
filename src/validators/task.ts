import { differenceInCalendarDays } from "date-fns";
import { z } from "zod";
import { TASK_STATUSES } from "@/lib/constants";
import { daySchema, idSchema } from "./common";

export const MAX_RANGE_DAYS = 62;
export const MAX_DETAILS = 2000;

const details = z
  .string({ error: "Describe the work" })
  .trim()
  .min(3, "Describe the work")
  .max(MAX_DETAILS, `Keep it under ${MAX_DETAILS} characters`);

/** Hours are optional, in quarter-hour steps. An empty input means no hours. */
const hours = z
  .union([z.number(), z.literal(""), z.null()])
  .transform((value) => (value === "" ? null : value))
  .refine((value) => value === null || (value > 0 && value <= 24), "Use 0.25 to 24 hours")
  .refine((value) => value === null || Number.isInteger(value * 4), "Use quarter-hour steps");

export const createTaskSchema = z.object({
  projectId: idSchema,
  details,
  hours: hours.optional().transform((value) => value ?? null),
  status: z.enum(TASK_STATUSES).default("Completed"),
  date: daySchema,
});
export type CreateTaskInput = z.output<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({ projectId: idSchema, details, hours, status: z.enum(TASK_STATUSES), date: daySchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateTaskInput = z.output<typeof updateTaskSchema>;

export const dateRangeSchema = z
  .object({ from: daySchema, to: daySchema })
  .refine((value) => value.from <= value.to, { path: ["to"], message: "The range ends before it starts" })
  .refine(
    (value) =>
      differenceInCalendarDays(new Date(value.to), new Date(value.from)) < MAX_RANGE_DAYS,
    { path: ["to"], message: `Choose a range of at most ${MAX_RANGE_DAYS} days` },
  );

export const copyTasksSchema = z.object({ date: daySchema });

export const createTemplateSchema = z.object({
  projectId: idSchema,
  details,
  hours: hours.optional().transform((value) => value ?? null),
});
