import { subDays } from "date-fns";
import { ORG_WIDE_ROLES, SUBMITTED_STATUSES } from "@/lib/constants";
import { submissionDeadline } from "@/lib/dashboards/service";
import { prisma } from "@/lib/db/prisma";
import { notify } from "@/lib/notifications";
import { dayString, isoWeekOf } from "@/lib/reports/iso-week";

const STALE_REVIEW_DAYS = 2;

/**
 * The reminder job. Safe to run as often as you like: each reminder has a key, and the same key
 * is never sent to the same person twice.
 * - From Friday 4 PM, everyone who hasn't submitted this week gets one reminder for the week.
 * - Every day, approvers get one reminder per report that has waited over two days.
 * Reminders go out in the app and by email, except to the CEO, who is never emailed.
 */
export async function sendReminders(now = new Date()) {
  const week = isoWeekOf(now);
  let submitReminders = 0;
  let reviewReminders = 0;

  if (now >= submissionDeadline(now)) {
    const people = await prisma.user.findMany({
      where: {
        role: { notIn: [...ORG_WIDE_ROLES] },
        departmentId: { not: null },
        isActive: true,
        approval: "APPROVED",
        reports: {
          none: { isoYear: week.isoYear, isoWeek: week.isoWeek, status: { in: [...SUBMITTED_STATUSES] } },
        },
      },
      select: { id: true, departmentId: true },
    });
    for (const person of people) {
      const sent = await notify({
        recipientId: person.id,
        departmentId: person.departmentId,
        type: "REMINDER",
        title: `Week ${week.isoWeek} isn't submitted yet`,
        message: `Please submit your tasks for week ${week.isoWeek} so your approver can review them.`,
        link: "/tasks?tab=weekly",
        dedupeKey: `submit:${week.isoYear}-${week.isoWeek}`,
        email: true,
      });
      if (sent) submitReminders++;
    }
  }

  const waiting = await prisma.weeklyReport.findMany({
    where: {
      status: { in: ["SUBMITTED", "LEAD_APPROVED"] },
      currentApproverId: { not: null },
      updatedAt: { lte: subDays(now, STALE_REVIEW_DAYS) },
    },
    select: {
      id: true,
      departmentId: true,
      currentApproverId: true,
      isoWeek: true,
      user: { select: { name: true } },
    },
  });
  for (const report of waiting) {
    const sent = await notify({
      recipientId: report.currentApproverId!,
      departmentId: report.departmentId,
      type: "REMINDER",
      title: `${report.user.name}'s week ${report.isoWeek} is waiting for you`,
      message: `${report.user.name}'s report for week ${report.isoWeek} has been waiting for your review for over ${STALE_REVIEW_DAYS} days.`,
      link: `/reports/${report.id}`,
      reportId: report.id,
      dedupeKey: `review:${report.id}:${dayString(now)}`,
      email: true,
    });
    if (sent) reviewReminders++;
  }

  return { submitReminders, reviewReminders };
}
