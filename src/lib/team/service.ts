import { Types, type FilterQuery } from "mongoose";
import { forbidden } from "@/lib/api/errors";
import { scopeFor, type Actor } from "@/lib/permissions";
import { isoWeekOf } from "@/lib/reports/iso-week";
import { visibleReportsFilter } from "@/lib/reports/visibility";
import { User, WeeklyReport, type IUser } from "@/models";

/**
 * The people under someone, with their current week. A Team Lead gets their direct reports, a
 * Manager their department, the CEO everyone (or one department). Hours appear only when the
 * week has reached the viewer; otherwise just its status shows.
 */
export async function listTeam(actor: Actor, selectedDepartmentId: string | null, page: number, limit: number) {
  if (actor.role === "DEVELOPER") throw forbidden();
  const self = new Types.ObjectId(actor.id);
  const filter: FilterQuery<IUser> =
    actor.role === "TEAM_LEAD"
      ? { ...scopeFor(actor), reportsTo: self, isActive: true }
      : { ...scopeFor(actor, selectedDepartmentId), _id: { $ne: self }, role: { $ne: "CEO" }, isActive: true };

  const [people, total] = await Promise.all([
    User.find(filter)
      .sort({ role: 1, name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate<{ reportsTo: { name: string } | null }>("reportsTo", "name")
      .lean(),
    User.countDocuments(filter),
  ]);
  const ids = people.map((person) => person._id);
  const week = isoWeekOf(new Date());
  const thisWeek = { userId: { $in: ids }, isoYear: week.isoYear, isoWeek: week.isoWeek };
  const [reports, visible] = await Promise.all([
    WeeklyReport.find(thisWeek).select("userId status submittedAt").lean(),
    WeeklyReport.find({ $and: [thisWeek, await visibleReportsFilter(actor)] }).select("userId totals.hours totals.blockedCount").lean(),
  ]);

  return {
    total,
    isoWeek: week.isoWeek,
    people: people.map((person) => {
      const report = reports.find((item) => String(item.userId) === String(person._id));
      const shown = visible.find((item) => String(item.userId) === String(person._id));
      return {
        id: String(person._id),
        name: person.name,
        role: person.role,
        avatarColor: person.avatarColor,
        reportsTo: person.reportsTo?.name ?? null,
        reportId: report ? String(report._id) : null,
        status: report?.status ?? null,
        submittedAt: report?.submittedAt?.toISOString() ?? null,
        hours: shown ? shown.totals.hours : null,
        blocked: shown ? shown.totals.blockedCount : null,
      };
    }),
  };
}

export type TeamMember = Awaited<ReturnType<typeof listTeam>>["people"][number];
