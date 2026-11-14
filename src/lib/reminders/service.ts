import { subDays } from "date-fns";
import { SUBMITTED_STATUSES } from "@/lib/constants";
import { notify } from "@/lib/notifications";
import { submissionDeadline } from "@/lib/dashboards/service";
import { dayString, isoWeekOf } from "@/lib/reports/iso-week";
import { User, WeeklyReport } from "@/models";

const STALE_REVIEW_DAYS = 2;

/**
 * The reminder job. Safe to run as often as you like: each reminder has a key, and the same key
 * is never sent to the same person twice.
 * - From Friday 4 PM, everyone who hasn't submitted this week gets one reminder for the week.
 * - Every day, approvers get one reminder per report that has waited over two days.
 */
export async function sendReminders(now = new Date()) {
  const week = isoWeekOf(now);
  let submitReminders = 0;
  let reviewReminders = 0;

  if (now >= submissionDeadline(now)) {
    const submitted = await WeeklyReport.find({
      isoYear: week.isoYear,
      isoWeek: week.isoWeek,
      status: { $in: SUBMITTED_STATUSES },
    }).distinct("userId");
    const people = User.find({ role: { $ne: "CEO" }, departmentId: { $ne: null }, isActive: true, _id: { $nin: submitted } })
      .select("_id departmentId")
      .lean()
      .cursor();
    for await (const person of people) {
      const sent = await notify({
        recipientId: person._id,
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

  const waiting = WeeklyReport.find({
    status: { $in: ["SUBMITTED", "LEAD_APPROVED"] },
    currentApproverId: { $ne: null },
    updatedAt: { $lte: subDays(now, STALE_REVIEW_DAYS) },
  })
    .select("_id departmentId currentApproverId isoWeek userId")
    .populate<{ userId: { name: string } }>("userId", "name")
    .lean()
    .cursor();
  for await (const report of waiting) {
    const sent = await notify({
      recipientId: report.currentApproverId!,
      departmentId: report.departmentId,
      type: "REMINDER",
      title: `${report.userId.name}'s week ${report.isoWeek} is waiting for you`,
      message: `${report.userId.name}'s report for week ${report.isoWeek} has been waiting for your review for over ${STALE_REVIEW_DAYS} days.`,
      link: `/reports/${report._id}`,
      reportId: report._id,
      dedupeKey: `review:${report._id}:${dayString(now)}`,
      email: true,
    });
    if (sent) reviewReminders++;
  }

  return { submitReminders, reviewReminders };
}
