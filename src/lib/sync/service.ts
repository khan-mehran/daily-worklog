import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { ApiError } from "@/lib/api/errors";
import { getActivitySummarizer, type ProjectActivity } from "@/lib/ai";
import type { SyncOrigin } from "@/lib/constants";
import { projectScope, type Actor } from "@/lib/permissions";
import { storedDay } from "@/lib/reports/iso-week";
import { createTask, requireLogger, updateTask } from "@/lib/tasks/service";
import { Project, Task } from "@/models";
import type { DailySyncInput } from "@/validators/sync";
import { MAX_DETAILS } from "@/validators/task";

const FALLBACK_MAX_BULLETS = 10;

export type SyncOutcome = "created" | "updated" | "unchanged" | "kept" | "skipped";
export interface SyncResult {
  code: string;
  project: string | null;
  outcome: SyncOutcome;
  message: string;
}

const hashDetails = (details: string) => createHash("sha256").update(details.trim()).digest("hex");

/** Without AI, the bullets are the day's distinct commit subjects. */
function fallbackBullets(activity: ProjectActivity) {
  const subjects = [...new Set(activity.commits.map((commit) => commit.subject))];
  const bullets = subjects.slice(0, FALLBACK_MAX_BULLETS);
  if (subjects.length > FALLBACK_MAX_BULLETS) bullets.push(`…and ${subjects.length - FALLBACK_MAX_BULLETS} more commits`);
  if (activity.uncommittedFiles.length > 0) {
    const names = activity.uncommittedFiles.slice(0, 3).map((file) => file.split("/").pop()).join(", ");
    const more = activity.uncommittedFiles.length > 3 ? ` and ${activity.uncommittedFiles.length - 3} more` : "";
    bullets.push(`In progress: uncommitted changes to ${names}${more}`);
  }
  return bullets;
}

async function summarize(activity: ProjectActivity) {
  const summarizer = getActivitySummarizer();
  if (summarizer) {
    try {
      return await summarizer.summarizeActivity(activity);
    } catch (error) {
      // A silent end-of-day sync should still log something, so fall back rather than fail.
      console.error("[sync] summary failed, using commit subjects", (error as Error).message);
    }
  }
  return fallbackBullets(activity);
}

/** Bullets as task details, trimmed to whole bullets that fit the details limit. */
function toDetails(bullets: string[]) {
  const lines: string[] = [];
  let length = 0;
  for (const bullet of bullets) {
    const text = bullet.replace(/^\s*[-*•]\s*/, "").trim();
    if (!text) continue;
    const line = `• ${text}`;
    if (length + line.length + 1 > MAX_DETAILS) break;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}

/**
 * Writes one task per project for the day from the developer's git activity. Running it again
 * the same day refreshes those tasks, except ones the person has edited since, which are kept.
 * Projects that can't be logged (unknown code, not assigned, locked week) are skipped, not fatal.
 */
export async function syncDay(actor: Actor, input: DailySyncInput): Promise<SyncResult[]> {
  requireLogger(actor);
  const results: SyncResult[] = [];

  for (const entry of input.projects) {
    const project = await Project.findOne({
      code: entry.code,
      ...projectScope(actor),
      status: { $ne: "Completed" },
    })
      .select("_id name")
      .lean();
    if (!project) {
      results.push({
        code: entry.code,
        project: null,
        outcome: "skipped",
        message: "No active project with this code that you're assigned to.",
      });
      continue;
    }
    const base = { code: entry.code, project: project.name };
    const syncedFrom: SyncOrigin = entry.items.length > 0 ? "items" : "activity";
    if (syncedFrom === "activity" && entry.commits.length === 0 && entry.uncommittedFiles.length === 0) {
      results.push({ ...base, outcome: "skipped", message: "No activity on this day." });
      continue;
    }

    const existing = await Task.findOne({
      userId: new Types.ObjectId(actor.id),
      projectId: project._id,
      date: storedDay(input.date),
      source: "sync",
    })
      .select("_id details syncHash syncedFrom")
      .lean();
    if (existing && existing.syncHash !== hashDetails(existing.details)) {
      results.push({ ...base, outcome: "kept", message: "You've edited this task, so the sync left it alone." });
      continue;
    }
    if (existing?.syncedFrom === "items" && syncedFrom === "activity") {
      results.push({ ...base, outcome: "kept", message: "Already logged from your /worklog list." });
      continue;
    }

    const bullets = syncedFrom === "items" ? entry.items : await summarize({ projectName: project.name, ...entry });
    const details = toDetails(bullets);
    const syncHash = hashDetails(details);
    try {
      if (!existing) {
        await createTask(
          actor,
          {
            projectId: String(project._id),
            details,
            hours: null,
            // Only uncommitted work means the day ended mid-task.
            status: entry.status ?? (syncedFrom === "activity" && entry.commits.length === 0 ? "In Progress" : "Completed"),
            date: input.date,
          },
          { source: "sync", syncHash, syncedFrom },
        );
        results.push({ ...base, outcome: "created", message: "Added to your tasks." });
      } else if (existing.syncHash === syncHash) {
        results.push({ ...base, outcome: "unchanged", message: "Already up to date." });
      } else {
        await updateTask(actor, existing._id, { details, ...(entry.status ? { status: entry.status } : {}) });
        await Task.updateOne({ _id: existing._id }, { syncHash, syncedFrom });
        results.push({ ...base, outcome: "updated", message: "Refreshed with the latest activity." });
      }
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        results.push({ ...base, outcome: "skipped", message: error.message });
        continue;
      }
      throw error;
    }
  }
  return results;
}
