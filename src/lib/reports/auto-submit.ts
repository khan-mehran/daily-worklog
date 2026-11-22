import { addDays, endOfDay, setHours, startOfISOWeek } from "date-fns";
import type { Role } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { isoWeekOf } from "./iso-week";
import { transitionReport } from "./service";

/** Whose unsubmitted week is sent for them. Managers submit to the CEO themselves. */
const AUTO_SUBMIT_ROLES = ["DEVELOPER", "TEAM_LEAD"] as const satisfies readonly Role[];

/** Thursday 6 PM of the current ISO week, server time. */
export const autoSubmitDeadline = (now = new Date()) => setHours(addDays(startOfISOWeek(now), 3), 18);

/**
 * Submits this week's report for every Developer and Team Lead who hasn't done it by Thursday
 * 6 PM. It follows the normal approval route, exactly as if the owner had pressed Submit, and
 * tells the owner it happened.
 *
 * Safe to run as often as you like: a submitted report is no longer a draft, so it is never
 * picked up twice. It only acts on Thursday evening, so a draft started later in the week stays
 * with its owner. Weeks with no tasks, and reports sent back for changes, are left alone.
 */
export async function autoSubmitReports(now = new Date()) {
  const deadline = autoSubmitDeadline(now);
  if (now < deadline || now > endOfDay(deadline)) return { autoSubmitted: 0 };

  const week = isoWeekOf(now);
  const drafts = await prisma.weeklyReport.findMany({
    where: {
      isoYear: week.isoYear,
      isoWeek: week.isoWeek,
      status: "DRAFT",
      taskCount: { gt: 0 },
      user: { role: { in: [...AUTO_SUBMIT_ROLES] }, isActive: true, approval: "APPROVED" },
    },
    select: { id: true, user: { select: { id: true, role: true, departmentId: true } } },
  });

  let autoSubmitted = 0;
  for (const draft of drafts) {
    try {
      await transitionReport(draft.user, draft.id, "submit", undefined, { automatic: true });
      autoSubmitted++;
    } catch (error) {
      // One report that can't go (no approver, or its owner submitted it this second) doesn't stop the rest.
      console.error(`Auto-submit skipped report ${draft.id}`, error);
    }
  }
  return { autoSubmitted };
}
