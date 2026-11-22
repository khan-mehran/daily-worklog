import type { Prisma } from "@prisma/client";
import { forbidden } from "@/lib/api/errors";
import { ORG_WIDE_ROLES, type PaletteColor } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { scopeFor, type Actor } from "@/lib/permissions";
import { isoWeekOf } from "@/lib/reports/iso-week";
import { visibleReportsFilter } from "@/lib/reports/visibility";

/**
 * The people under someone, with their current week. A Team Lead gets their direct reports, a
 * Manager their department, the CEO and Super Admin everyone (or one department). Hours appear only when the
 * week has reached the viewer; otherwise just its status shows.
 */
export async function listTeam(actor: Actor, selectedDepartmentId: string | null, page: number, limit: number) {
  if (actor.role === "DEVELOPER") throw forbidden();
  const where: Prisma.UserWhereInput =
    actor.role === "TEAM_LEAD"
      ? { ...scopeFor(actor), reportsTo: actor.id, isActive: true, approval: "APPROVED" }
      : {
          ...scopeFor(actor, selectedDepartmentId),
          id: { not: actor.id },
          role: { notIn: [...ORG_WIDE_ROLES] },
          isActive: true,
          approval: "APPROVED",
        };

  const [people, total] = await Promise.all([
    prisma.user.findMany({
      where,
      // The Role enum is declared in seniority order, so managers come first.
      orderBy: [{ role: "asc" }, { name: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: { approver: { select: { name: true } } },
    }),
    prisma.user.count({ where }),
  ]);
  const week = isoWeekOf(new Date());
  const thisWeek = {
    userId: { in: people.map((person) => person.id) },
    isoYear: week.isoYear,
    isoWeek: week.isoWeek,
  };
  const [reports, visible] = await Promise.all([
    prisma.weeklyReport.findMany({
      where: thisWeek,
      select: { id: true, userId: true, status: true, submittedAt: true },
    }),
    prisma.weeklyReport.findMany({
      where: { AND: [thisWeek, await visibleReportsFilter(actor)] },
      select: { userId: true, totalHours: true, blockedCount: true },
    }),
  ]);

  return {
    total,
    isoWeek: week.isoWeek,
    people: people.map((person) => {
      const report = reports.find((item) => item.userId === person.id);
      const shown = visible.find((item) => item.userId === person.id);
      return {
        id: person.id,
        name: person.name,
        role: person.role,
        avatarColor: person.avatarColor as PaletteColor,
        reportsTo: person.approver?.name ?? null,
        reportId: report?.id ?? null,
        status: report?.status ?? null,
        submittedAt: report?.submittedAt?.toISOString() ?? null,
        hours: shown ? shown.totalHours : null,
        blocked: shown ? shown.blockedCount : null,
      };
    }),
  };
}

export type TeamMember = Awaited<ReturnType<typeof listTeam>>["people"][number];
