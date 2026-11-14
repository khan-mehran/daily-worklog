import { differenceInCalendarDays } from "date-fns";
import { z } from "zod";
import { daySchema } from "./common";

export const MAX_DASHBOARD_DAYS = 366;

export const dashboardQuerySchema = z
  .object({ from: daySchema, to: daySchema })
  .refine((value) => value.from <= value.to, { path: ["to"], message: "The range ends before it starts" })
  .refine((value) => differenceInCalendarDays(new Date(value.to), new Date(value.from)) < MAX_DASHBOARD_DAYS, {
    path: ["to"],
    message: "Choose a range of at most a year",
  });
