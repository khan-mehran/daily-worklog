import { z } from "zod";
import { TASK_STATUSES } from "@/lib/constants";
import { daySchema } from "./common";

export const MAX_SYNC_PROJECTS = 10;
const MAX_ITEMS = 20;
const MAX_ITEM_LENGTH = 400;
const MAX_COMMITS = 100;
const MAX_FILES = 200;

const filePath = z.string().trim().min(1).max(300);

/** One day of git activity from the VS Code sync, grouped by WorkLog project code. */
export const dailySyncSchema = z.object({
  date: daySchema,
  projects: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(20).toUpperCase(),
        commits: z
          .array(z.object({ subject: z.string().trim().min(1).max(300), body: z.string().trim().max(2000).default("") }))
          .max(MAX_COMMITS)
          .default([]),
        changedFiles: z.array(filePath).max(MAX_FILES).default([]),
        uncommittedFiles: z.array(filePath).max(MAX_FILES).default([]),
        /**
         * A finished work list, written on the developer's machine (the /worklog command). When
         * present it's used as the task as-is, and commits and files are ignored.
         */
        items: z.array(z.string().trim().min(3).max(MAX_ITEM_LENGTH)).max(MAX_ITEMS).default([]),
        status: z.enum(TASK_STATUSES).optional(),
      }),
    )
    .min(1, "No project activity to sync")
    .max(MAX_SYNC_PROJECTS, `Sync at most ${MAX_SYNC_PROJECTS} projects at a time`),
});
export type DailySyncInput = z.output<typeof dailySyncSchema>;
