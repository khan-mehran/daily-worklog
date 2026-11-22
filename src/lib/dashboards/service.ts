import type { Prisma } from "@prisma/client";
import { addDays, differenceInCalendarDays, format, isWeekend, setHours, startOfISOWeek, subDays, subMonths, subWeeks } from "date-fns";
import { forbidden } from "@/lib/api/errors";
import { ORG_WIDE_ROLES, REPORT_STATUS_LABELS, ROLE_LABELS, seesAllDepartments, SUBMITTED_STATUSES, type PaletteColor, type ProjectStatus, type ReportStatus } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { scopeFor, type Actor } from "@/lib/permissions";
import { dayString, isoWeekOf, localDay, storedDay, todayString } from "@/lib/reports/iso-week";
import { openableReportsFilter, visibleTasksFilter } from "@/lib/reports/visibility";

export interface DateRange {
  from: string;
  to: string;
}

type TaskWhere = Prisma.TaskWhereInput;

const PER_DAY_LIMIT = 45;
const TREND_WEEKS = 8;
const TIMELINE_WEEKS = 6;
const TREND_MONTHS = 6;

const inRange = (range: DateRange) => ({ date: { gte: storedDay(range.from), lte: storedDay(range.to) } });
const round = (value: number) => Math.round(value * 100) / 100;

/** The Monday of a stored day's ISO week, as yyyy-mm-dd. */
function weekKey(date: Date) {
  const monday = new Date(date);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return dayString(monday);
}

/** Names and colours for a set of projects, in one query. */
async function projectNames(ids: string[]) {
  const projects = await prisma.project.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, color: true, status: true, departmentId: true },
  });
  return new Map(projects.map((project) => [project.id, project]));
}

async function peopleNames(ids: string[]) {
  const people = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, role: true, avatarColor: true, reportsTo: true },
  });
  return new Map(people.map((person) => [person.id, person]));
}

/** Hours by project for a task filter, largest first, with names and colours. */
async function hoursByProject(where: TaskWhere) {
  const rows = await prisma.task.groupBy({
    by: ["projectId"],
    where,
    _sum: { hours: true },
    _count: { _all: true },
  });
  const names = await projectNames(rows.map((row) => row.projectId));
  return rows
    .map((row) => ({
      id: row.projectId,
      name: names.get(row.projectId)?.name ?? "Deleted project",
      color: (names.get(row.projectId)?.color ?? "slate") as PaletteColor,
      hours: round(row._sum.hours ?? 0),
      tasks: row._count._all,
    }))
    .sort((a, b) => b.hours - a.hours);
}

/** Hours per stored day for a task filter. The callers bucket days into weeks or months. */
async function hoursByDay(where: TaskWhere) {
  const rows = await prisma.task.groupBy({ by: ["date"], where, _sum: { hours: true } });
  return rows.map((row) => ({ date: row.date, hours: row._sum.hours ?? 0 }));
}

/** Per day for short ranges, per ISO week for long ones, so the chart stays readable. */
async function timeSeries(where: TaskWhere, range: DateRange) {
  const perDay = differenceInCalendarDays(localDay(range.to), localDay(range.from)) < PER_DAY_LIMIT;
  const rows = await prisma.task.groupBy({
    by: ["date", "status"],
    where,
    _sum: { hours: true },
    _count: { _all: true },
  });
  const buckets = new Map<string, { hours: number; completed: number }>();
  for (const row of rows) {
    const key = perDay ? dayString(row.date) : weekKey(row.date);
    const bucket = buckets.get(key) ?? { hours: 0, completed: 0 };
    bucket.hours += row._sum.hours ?? 0;
    if (row.status === "Completed") bucket.completed += row._count._all;
    buckets.set(key, bucket);
  }

  const points = [];
  if (perDay) {
    for (let day = localDay(range.from); day <= localDay(range.to); day = addDays(day, 1)) {
      const bucket = buckets.get(format(day, "yyyy-MM-dd"));
      points.push({ label: format(day, "d MMM"), hours: round(bucket?.hours ?? 0), completed: bucket?.completed ?? 0 });
    }
  } else {
    for (const [key, bucket] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
      points.push({ label: `W${isoWeekOf(localDay(key)).isoWeek}`, hours: round(bucket.hours), completed: bucket.completed });
    }
  }
  return { unit: perDay ? ("day" as const) : ("week" as const), points };
}

/** Hours per ISO week for the weeks ending with the range's last week. */
async function weeklyTrend(where: TaskWhere, to: string) {
  const end = localDay(to);
  const start = startOfISOWeek(subWeeks(end, TREND_WEEKS - 1));
  const days = await hoursByDay({
    AND: [where, { date: { gte: storedDay(format(start, "yyyy-MM-dd")), lte: storedDay(to) } }],
  });
  const byWeek = new Map<string, number>();
  for (const day of days) byWeek.set(weekKey(day.date), (byWeek.get(weekKey(day.date)) ?? 0) + day.hours);
  return Array.from({ length: TREND_WEEKS }, (_, index) => {
    const weekStart = addDays(start, index * 7);
    const key = format(weekStart, "yyyy-MM-dd");
    return { label: `W${isoWeekOf(weekStart).isoWeek}`, hours: round(byWeek.get(key) ?? 0) };
  });
}

async function blockedTasks(where: TaskWhere, limit: number) {
  const tasks = await prisma.task.findMany({
    where: { AND: [where, { status: "Blocked" }] },
    orderBy: { date: "desc" },
    take: limit,
    include: { project: { select: { name: true, color: true } }, user: { select: { name: true } } },
  });
  return tasks.map((task) => ({
    id: task.id,
    date: dayString(task.date),
    details: task.details,
    reportId: task.weeklyReportId,
    person: task.user.name,
    project: { name: task.project.name, color: task.project.color as PaletteColor },
  }));
}

/** Consecutive working days, up to today, with at least one task. Today doesn't break it yet. */
async function currentStreak(userId: string) {
  const today = localDay(todayString());
  const logged = await prisma.task.findMany({
    where: { userId, date: { gte: storedDay(format(subDays(today, 90), "yyyy-MM-dd")) } },
    distinct: ["date"],
    select: { date: true },
  });
  const days = new Set(logged.map((task) => dayString(task.date)));
  let streak = 0;
  let day = days.has(format(today, "yyyy-MM-dd")) ? today : subDays(today, 1);
  for (let checked = 0; checked < 90; checked++, day = subDays(day, 1)) {
    if (isWeekend(day)) continue;
    if (!days.has(format(day, "yyyy-MM-dd"))) break;
    streak++;
  }
  return streak;
}

function kpis(byProject: { hours: number; tasks: number }[], completed: number, blocked: number) {
  const tasks = byProject.reduce((sum, row) => sum + row.tasks, 0);
  return {
    hours: round(byProject.reduce((sum, row) => sum + row.hours, 0)),
    tasks,
    completionRate: tasks ? Math.round((completed / tasks) * 100) : 0,
    blocked,
  };
}

async function countByStatus(where: TaskWhere) {
  const rows = await prisma.task.groupBy({ by: ["status"], where, _count: { _all: true } });
  const get = (status: string) => rows.find((row) => row.status === status)?._count._all ?? 0;
  return { completed: get("Completed"), blocked: get("Blocked") };
}

async function reviewQueueSummary(actor: Actor, selectedDepartmentId: string | null) {
  const where: Prisma.WeeklyReportWhereInput = {
    ...scopeFor(actor, selectedDepartmentId),
    currentApproverId: actor.id,
    status: { in: ["SUBMITTED", "LEAD_APPROVED"] },
  };
  const [count, reports] = await Promise.all([
    prisma.weeklyReport.count({ where }),
    prisma.weeklyReport.findMany({
      where,
      orderBy: { submittedAt: "asc" },
      take: 5,
      include: { user: { select: { name: true } } },
    }),
  ]);
  return {
    count,
    items: reports.map((report) => ({
      id: report.id,
      person: report.user.name,
      isoWeek: report.isoWeek,
      hours: report.totalHours,
      blocked: report.blockedCount,
      submittedAt: report.submittedAt?.toISOString() ?? null,
    })),
  };
}

/** Everyone's own work: the Developer dashboard, which Team Leads and Managers also get. */
export async function developerDashboard(actor: Actor, range: DateRange) {
  if (seesAllDepartments(actor.role)) throw forbidden("The CEO doesn't log tasks.");
  const userId = actor.id;
  const where = { userId, ...inRange(range) };
  const [byProject, series, trend, statuses, blockers, streak, timeline] = await Promise.all([
    hoursByProject(where),
    timeSeries(where, range),
    weeklyTrend({ userId }, range.to),
    countByStatus(where),
    blockedTasks(where, 10),
    currentStreak(userId),
    prisma.weeklyReport.findMany({ where: { userId }, orderBy: { weekStart: "desc" }, take: TIMELINE_WEEKS }),
  ]);
  return {
    kpis: { ...kpis(byProject, statuses.completed, statuses.blocked), streak },
    byProject,
    series,
    trend,
    blockers,
    timeline: timeline.reverse().map((report) => ({
      id: report.id,
      isoWeek: report.isoWeek,
      weekStart: dayString(report.weekStart),
      status: report.status,
      hours: report.totalHours,
    })),
  };
}

/** Friday 4 PM of the current ISO week: after it, an unsubmitted week counts as late. */
export const submissionDeadline = (now = new Date()) => setHours(addDays(startOfISOWeek(now), 4), 16);

const pickWeek = (date: Date) => {
  const week = isoWeekOf(date);
  return { isoYear: week.isoYear, isoWeek: week.isoWeek };
};

/** The Team Lead's view of their direct reports, from work that has reached them. */
export async function leadDashboard(actor: Actor, range: DateRange) {
  if (actor.role !== "TEAM_LEAD") throw forbidden();
  const team = await prisma.user.findMany({
    where: { reportsTo: actor.id, departmentId: actor.departmentId!, isActive: true },
    select: { id: true, name: true, avatarColor: true },
    orderBy: { name: "asc" },
  });
  const teamIds = team.map((member) => member.id);
  const where: TaskWhere = { AND: [await visibleTasksFilter(actor), { userId: { in: teamIds }, ...inRange(range) }] };

  const [perMember, byProject, blockers, queue, currentReports] = await Promise.all([
    prisma.task.groupBy({ by: ["userId", "projectId"], where, _sum: { hours: true } }),
    hoursByProject(where),
    blockedTasks(where, 8),
    reviewQueueSummary(actor, null),
    prisma.weeklyReport.findMany({ where: { userId: { in: teamIds }, ...pickWeek(new Date()) } }),
  ]);

  const projectsById = new Map(byProject.map((project) => [project.id, project]));
  const late = new Date() > submissionDeadline();
  return {
    // One row per person, one series per project: the stacked bar.
    hoursByMember: {
      series: byProject.map((project) => ({ key: project.id, name: project.name, color: project.color })),
      rows: team.map((member) => {
        const row: Record<string, string | number> = { label: member.name };
        for (const entry of perMember.filter((item) => item.userId === member.id)) {
          if (projectsById.has(entry.projectId)) row[entry.projectId] = round(entry._sum.hours ?? 0);
        }
        return row;
      }),
    },
    byProject,
    blockers,
    queue,
    compliance: team.map((member) => {
      const report = currentReports.find((item) => item.userId === member.id);
      const submitted = Boolean(report && SUBMITTED_STATUSES.includes(report.status));
      return {
        id: member.id,
        name: member.name,
        avatarColor: member.avatarColor as PaletteColor,
        status: (report?.status ?? null) as ReportStatus | null,
        submitted,
        late: !submitted && late,
      };
    }),
  };
}

/** The Manager's department: everything past the Team Lead, plus their leads' own submitted work. */
export async function managerDashboard(actor: Actor, range: DateRange) {
  if (actor.role !== "MANAGER" || !actor.departmentId) throw forbidden();
  const departmentId = actor.departmentId;
  const visible = await visibleTasksFilter(actor);
  const where: TaskWhere = { AND: [visible, { departmentId, ...inRange(range) }] };

  const [byProject, perUser, trend, queue, funnelRows, healthRows, projects, leads] = await Promise.all([
    hoursByProject(where),
    prisma.task.groupBy({ by: ["userId"], where, _sum: { hours: true } }),
    weeklyTrend({ AND: [visible, { departmentId }] }, range.to),
    reviewQueueSummary(actor, null),
    prisma.weeklyReport.groupBy({
      by: ["status"],
      where: { departmentId, weekStart: { gte: storedDay(range.from), lte: storedDay(range.to) } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["projectId", "userId", "status"],
      where,
      _sum: { hours: true },
      _count: { _all: true },
    }),
    prisma.project.findMany({
      where: { departmentId },
      select: { id: true, name: true, color: true, status: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { departmentId, role: "TEAM_LEAD", isActive: true },
      select: { id: true, name: true },
    }),
  ]);

  // Each person's hours count towards their Team Lead's team. A lead's own hours count too.
  const people = await peopleNames(perUser.map((row) => row.userId));
  const leadOf = (userId: string) => {
    const person = people.get(userId);
    if (!person) return null;
    if (person.role === "TEAM_LEAD") return userId;
    if (person.role === "DEVELOPER") return person.reportsTo;
    return null;
  };
  const workload = leads.map((lead) => ({
    label: `${lead.name}'s team`,
    hours: round(
      perUser.filter((row) => leadOf(row.userId) === lead.id).reduce((sum, row) => sum + (row._sum.hours ?? 0), 0),
    ),
  }));

  const health = new Map<string, { hours: number; contributors: Set<string>; blocked: number }>();
  for (const row of healthRows) {
    const entry = health.get(row.projectId) ?? { hours: 0, contributors: new Set<string>(), blocked: 0 };
    entry.hours += row._sum.hours ?? 0;
    entry.contributors.add(row.userId);
    if (row.status === "Blocked") entry.blocked += row._count._all;
    health.set(row.projectId, entry);
  }

  const count = (statuses: ReportStatus[]) =>
    funnelRows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
  const thisWeek = trend.at(-1)?.hours ?? 0;
  const lastWeek = trend.at(-2)?.hours ?? 0;

  return {
    kpis: {
      hours: round(byProject.reduce((sum, row) => sum + row.hours, 0)),
      pending: queue.count,
      thisWeek,
      weekOverWeek: lastWeek ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null,
    },
    byProject,
    workload,
    trend,
    queue,
    funnel: [
      { label: "Submitted", count: count(["SUBMITTED", "LEAD_APPROVED", "MANAGER_APPROVED"]) },
      { label: "Lead approved", count: count(["LEAD_APPROVED", "MANAGER_APPROVED"]) },
      { label: "Manager approved", count: count(["MANAGER_APPROVED"]) },
    ],
    projectHealth: projects.map((project) => {
      const row = health.get(project.id);
      return {
        id: project.id,
        name: project.name,
        color: project.color as PaletteColor,
        status: project.status as ProjectStatus,
        hours: round(row?.hours ?? 0),
        contributors: row?.contributors.size ?? 0,
        blocked: row?.blocked ?? 0,
      };
    }),
  };
}

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;

/** The CEO's view, which a Super Admin shares. Every number comes from fully approved work only. */
export async function ceoDashboard(actor: Actor, selectedDepartmentId: string | null, range: DateRange) {
  if (!seesAllDepartments(actor.role)) throw forbidden();
  const scope = scopeFor(actor, selectedDepartmentId);
  const approved = { reportStatus: "MANAGER_APPROVED" as const };
  const where: TaskWhere = { ...approved, ...scope, ...inRange(range) };
  const now = new Date();
  const week = isoWeekOf(now);
  const monthsStart = storedDay(format(subMonths(localDay(range.to), TREND_MONTHS - 1), "yyyy-MM-01"));

  const [byProject, byDepartment, perUser, days, approvedReports, headcount, departments, approvedThisWeek, pendingAcks, activeProjects] =
    await Promise.all([
      hoursByProject(where),
      // The comparison always shows every department, whatever the switcher says.
      prisma.task.groupBy({ by: ["departmentId"], where: { ...approved, ...inRange(range) }, _sum: { hours: true } }),
      prisma.task.groupBy({ by: ["userId"], where, _sum: { hours: true } }),
      hoursByDay({ ...approved, ...scope, date: { gte: monthsStart } }),
      prisma.weeklyReport.findMany({
        where: {
          ...scope,
          status: "MANAGER_APPROVED",
          submittedAt: { not: null },
          managerApprovedAt: { gte: storedDay(range.from), lte: addDays(storedDay(range.to), 1) },
        },
        select: { submittedAt: true, leadApprovedAt: true, managerApprovedAt: true },
      }),
      prisma.user.groupBy({
        by: ["role"],
        where: { ...scope, isActive: true, approval: "APPROVED", role: { notIn: [...ORG_WIDE_ROLES] } },
        _count: { _all: true },
      }),
      prisma.department.findMany({
        where: { status: "Active" },
        select: { id: true, name: true, color: true },
        orderBy: { name: "asc" },
      }),
      prisma.weeklyReport.count({
        where: { ...scope, status: "MANAGER_APPROVED", managerApprovedAt: { gte: week.weekStart } },
      }),
      prisma.weeklyReport.count({ where: { ...scope, currentApproverId: actor.id, status: "SUBMITTED" } }),
      prisma.project.count({ where: { ...scope, status: "Active" } }),
    ]);

  const people = await peopleNames(perUser.map((row) => row.userId));
  const leadIds = new Set<string>();
  const teamOf = (userId: string) => {
    const person = people.get(userId);
    if (!person) return null;
    if (person.role === "TEAM_LEAD") return userId;
    if (person.role === "DEVELOPER" && person.reportsTo) return person.reportsTo;
    return "managers";
  };
  const teamHours = new Map<string, number>();
  for (const row of perUser) {
    const team = teamOf(row.userId);
    if (!team) continue;
    if (team !== "managers") leadIds.add(team);
    teamHours.set(team, (teamHours.get(team) ?? 0) + (row._sum.hours ?? 0));
  }
  const leads = await peopleNames([...leadIds]);
  const departmentHours = new Map(byDepartment.map((row) => [row.departmentId, row._sum.hours ?? 0]));
  const hours = (milliseconds: number | undefined) => (milliseconds ? round(milliseconds / 3_600_000) : null);
  const projectMap = await projectNames(byProject.map((row) => row.id));
  const departmentNames = new Map(departments.map((department) => [department.id, department.name]));

  const monthHours = new Map<string, number>();
  for (const day of days) {
    const key = dayString(day.date).slice(0, 7);
    monthHours.set(key, (monthHours.get(key) ?? 0) + day.hours);
  }
  const totalTurnaround = average(
    approvedReports.map((report) => report.managerApprovedAt!.getTime() - report.submittedAt!.getTime()),
  );
  const leadTurnaround = average(
    approvedReports
      .filter((report) => report.leadApprovedAt)
      .map((report) => report.leadApprovedAt!.getTime() - report.submittedAt!.getTime()),
  );

  return {
    kpis: {
      approvedHours: round(byProject.reduce((sum, row) => sum + row.hours, 0)),
      approvedThisWeek,
      pendingAcks,
      headcount: headcount.reduce((sum, row) => sum + row._count._all, 0),
      activeProjects,
      turnaroundHours: hours(totalTurnaround),
    },
    byProject,
    byDepartment: departments.map((department) => ({
      id: department.id,
      label: department.name,
      color: department.color as PaletteColor,
      hours: round(departmentHours.get(department.id) ?? 0),
      selected: selectedDepartmentId === department.id,
    })),
    byTeam: [...teamHours]
      .map(([team, value]) => ({
        label: team === "managers" ? "Managers" : `${leads.get(team)?.name ?? "Unknown"}'s team`,
        hours: round(value),
      }))
      .sort((a, b) => b.hours - a.hours),
    monthly: Array.from({ length: TREND_MONTHS }, (_, index) => {
      const month = subMonths(localDay(range.to), TREND_MONTHS - 1 - index);
      return { label: format(month, "MMM"), hours: round(monthHours.get(format(month, "yyyy-MM")) ?? 0) };
    }),
    portfolio: byProject.map((row) => {
      const project = projectMap.get(row.id);
      return {
        ...row,
        status: project?.status ?? "",
        department: (project && departmentNames.get(project.departmentId)) ?? "",
      };
    }),
    turnaround: {
      reports: approvedReports.length,
      totalHours: hours(totalTurnaround),
      leadHours: hours(leadTurnaround),
    },
    headcount: (["MANAGER", "TEAM_LEAD", "DEVELOPER"] as const).map((role) => ({
      role: ROLE_LABELS[role],
      count: headcount.find((row) => row.role === role)?._count._all ?? 0,
    })),
  };
}

const ACTIVITY_VERBS: Record<string, string> = {
  SUBMITTED: "submitted",
  LEAD_APPROVED: "approved",
  MANAGER_APPROVED: "gave final approval to",
  CEO_ACKNOWLEDGED: "acknowledged",
  CHANGES_REQUESTED: "requested changes on",
};

/** "Priya Nair submitted week 44", from report histories the viewer can open. */
export async function activityFeed(actor: Actor, selectedDepartmentId: string | null, limit = 12) {
  const entries = await prisma.reportTrailEntry.findMany({
    where: { report: { AND: [await openableReportsFilter(actor), scopeFor(actor, selectedDepartmentId)] } },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: limit,
    include: {
      report: { select: { id: true, isoWeek: true, userId: true, user: { select: { name: true } } } },
      by: { select: { name: true, avatarColor: true } },
    },
  });
  return entries.map((entry) => {
    const own = entry.report.userId === entry.byUserId;
    return {
      id: `${entry.report.id}-${entry.at.toISOString()}`,
      reportId: entry.report.id,
      text: `${entry.by.name} ${ACTIVITY_VERBS[entry.action] ?? "updated"} ${own ? "" : `${entry.report.user.name}'s `}week ${entry.report.isoWeek}`,
      at: entry.at.toISOString(),
      avatarColor: entry.by.avatarColor as PaletteColor,
      actorName: entry.by.name,
    };
  });
}

export { REPORT_STATUS_LABELS };
