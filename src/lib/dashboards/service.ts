import { addDays, differenceInCalendarDays, format, isWeekend, setHours, startOfISOWeek, subDays, subMonths, subWeeks } from "date-fns";
import { Types, type FilterQuery, type PipelineStage } from "mongoose";
import { forbidden } from "@/lib/api/errors";
import { REPORT_STATUS_LABELS, ROLE_LABELS, SUBMITTED_STATUSES, type ReportStatus, type Role } from "@/lib/constants";
import { scopeFor, type Actor } from "@/lib/permissions";
import { dayString, isoWeekOf, localDay, storedDay, todayString } from "@/lib/reports/iso-week";
import { openableReportsFilter, visibleTasksFilter } from "@/lib/reports/visibility";
import { Department, Project, Task, User, WeeklyReport, type ITask } from "@/models";

export interface DateRange {
  from: string;
  to: string;
}

const PER_DAY_LIMIT = 45;
const TREND_WEEKS = 8;
const TIMELINE_WEEKS = 6;
const TREND_MONTHS = 6;

const hoursSum = { $sum: { $ifNull: ["$hours", 0] } };
const inRange = (range: DateRange) => ({ date: { $gte: storedDay(range.from), $lte: storedDay(range.to) } });
const oid = (id: string) => new Types.ObjectId(id);
const round = (value: number) => Math.round(value * 100) / 100;

/** Names and colours for a set of projects, in one query. */
async function projectNames(ids: Types.ObjectId[]) {
  const projects = await Project.find({ _id: { $in: ids } }).select("name color status departmentId").lean();
  return new Map(projects.map((project) => [String(project._id), project]));
}

async function peopleNames(ids: Types.ObjectId[]) {
  const people = await User.find({ _id: { $in: ids } }).select("name role avatarColor reportsTo").lean();
  return new Map(people.map((person) => [String(person._id), person]));
}

/** Hours by project for a task filter, largest first, with names and colours. */
async function hoursByProject(match: FilterQuery<ITask>) {
  const rows = await Task.aggregate<{ _id: Types.ObjectId; hours: number; tasks: number }>([
    { $match: match },
    { $group: { _id: "$projectId", hours: hoursSum, tasks: { $sum: 1 } } },
    { $sort: { hours: -1 } },
  ]);
  const names = await projectNames(rows.map((row) => row._id));
  return rows.map((row) => ({
    id: String(row._id),
    name: names.get(String(row._id))?.name ?? "Deleted project",
    color: names.get(String(row._id))?.color ?? "slate",
    hours: round(row.hours),
    tasks: row.tasks,
  }));
}

/** Per day for short ranges, per ISO week for long ones, so the chart stays readable. */
async function timeSeries(match: FilterQuery<ITask>, range: DateRange) {
  const perDay = differenceInCalendarDays(localDay(range.to), localDay(range.from)) < PER_DAY_LIMIT;
  const bucket = perDay ? "$date" : { $dateTrunc: { date: "$date", unit: "week", startOfWeek: "monday" } };
  const rows = await Task.aggregate<{ _id: Date; hours: number; completed: number; tasks: number }>([
    { $match: match },
    {
      $group: {
        _id: bucket,
        hours: hoursSum,
        tasks: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const byKey = new Map(rows.map((row) => [dayString(row._id), row]));
  const points = [];
  if (perDay) {
    for (let day = localDay(range.from); day <= localDay(range.to); day = addDays(day, 1)) {
      const key = format(day, "yyyy-MM-dd");
      const row = byKey.get(key);
      points.push({ label: format(day, "d MMM"), hours: round(row?.hours ?? 0), completed: row?.completed ?? 0 });
    }
  } else {
    for (const row of rows) {
      points.push({ label: `W${isoWeekOf(localDay(dayString(row._id))).isoWeek}`, hours: round(row.hours), completed: row.completed });
    }
  }
  return { unit: perDay ? ("day" as const) : ("week" as const), points };
}

/** Hours per ISO week for the weeks ending with the range's last week. */
async function weeklyTrend(match: FilterQuery<ITask>, to: string) {
  const end = localDay(to);
  const start = startOfISOWeek(subWeeks(end, TREND_WEEKS - 1));
  const rows = await Task.aggregate<{ _id: Date; hours: number }>([
    { $match: { ...match, date: { $gte: storedDay(format(start, "yyyy-MM-dd")), $lte: storedDay(to) } } },
    { $group: { _id: { $dateTrunc: { date: "$date", unit: "week", startOfWeek: "monday" } }, hours: hoursSum } },
  ]);
  const byWeek = new Map(rows.map((row) => [dayString(row._id), row.hours]));
  return Array.from({ length: TREND_WEEKS }, (_, index) => {
    const weekStart = addDays(start, index * 7);
    const key = format(weekStart, "yyyy-MM-dd");
    return { label: `W${isoWeekOf(weekStart).isoWeek}`, hours: round(byWeek.get(key) ?? 0) };
  });
}

async function blockedTasks(match: FilterQuery<ITask>, limit: number) {
  const tasks = await Task.find({ ...match, status: "Blocked" }).sort({ date: -1 }).limit(limit).lean();
  const [projects, people] = await Promise.all([
    projectNames(tasks.map((task) => task.projectId)),
    peopleNames(tasks.map((task) => task.userId)),
  ]);
  return tasks.map((task) => ({
    id: String(task._id),
    date: dayString(task.date),
    details: task.details,
    reportId: String(task.weeklyReportId),
    person: people.get(String(task.userId))?.name ?? "",
    project: {
      name: projects.get(String(task.projectId))?.name ?? "",
      color: projects.get(String(task.projectId))?.color ?? "slate",
    },
  }));
}

/** Consecutive working days, up to today, with at least one task. Today doesn't break it yet. */
async function currentStreak(userId: Types.ObjectId) {
  const today = localDay(todayString());
  const days = new Set(
    (await Task.distinct("date", { userId, date: { $gte: storedDay(format(subDays(today, 90), "yyyy-MM-dd")) } })).map(
      (date: Date) => dayString(date),
    ),
  );
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

async function countByStatus(match: FilterQuery<ITask>) {
  const rows = await Task.aggregate<{ _id: string; count: number }>([
    { $match: match },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const get = (status: string) => rows.find((row) => row._id === status)?.count ?? 0;
  return { completed: get("Completed"), blocked: get("Blocked") };
}

async function reviewQueueSummary(actor: Actor, selectedDepartmentId: string | null) {
  const filter = {
    ...scopeFor(actor, selectedDepartmentId),
    currentApproverId: oid(actor.id),
    status: { $in: ["SUBMITTED", "LEAD_APPROVED"] },
  };
  const [count, reports] = await Promise.all([
    WeeklyReport.countDocuments(filter),
    WeeklyReport.find(filter).sort({ submittedAt: 1 }).limit(5).lean(),
  ]);
  const people = await peopleNames(reports.map((report) => report.userId));
  return {
    count,
    items: reports.map((report) => ({
      id: String(report._id),
      person: people.get(String(report.userId))?.name ?? "",
      isoWeek: report.isoWeek,
      hours: report.totals.hours,
      blocked: report.totals.blockedCount,
      submittedAt: report.submittedAt?.toISOString() ?? null,
    })),
  };
}

/** Everyone's own work: the Developer dashboard, which Team Leads and Managers also get. */
export async function developerDashboard(actor: Actor, range: DateRange) {
  if (actor.role === "CEO") throw forbidden("The CEO doesn't log tasks.");
  const userId = oid(actor.id);
  const match = { userId, ...inRange(range) };
  const [byProject, series, trend, statuses, blockers, streak, timeline] = await Promise.all([
    hoursByProject(match),
    timeSeries(match, range),
    weeklyTrend({ userId }, range.to),
    countByStatus(match),
    blockedTasks(match, 10),
    currentStreak(userId),
    WeeklyReport.find({ userId }).sort({ weekStart: -1 }).limit(TIMELINE_WEEKS).lean(),
  ]);
  return {
    kpis: { ...kpis(byProject, statuses.completed, statuses.blocked), streak },
    byProject,
    series,
    trend,
    blockers,
    timeline: timeline.reverse().map((report) => ({
      id: String(report._id),
      isoWeek: report.isoWeek,
      weekStart: dayString(report.weekStart),
      status: report.status,
      hours: report.totals.hours,
    })),
  };
}

/** Friday 4 PM of the current ISO week: after it, an unsubmitted week counts as late. */
export const submissionDeadline = (now = new Date()) => setHours(addDays(startOfISOWeek(now), 4), 16);

/** The Team Lead's view of their direct reports, from work that has reached them. */
export async function leadDashboard(actor: Actor, range: DateRange) {
  if (actor.role !== "TEAM_LEAD") throw forbidden();
  const team = await User.find({ reportsTo: oid(actor.id), departmentId: oid(actor.departmentId!), isActive: true })
    .select("name avatarColor")
    .sort({ name: 1 })
    .lean();
  const teamIds = team.map((member) => member._id);
  const match = { $and: [await visibleTasksFilter(actor), { userId: { $in: teamIds }, ...inRange(range) }] };

  const [perMember, byProject, blockers, queue, currentReports] = await Promise.all([
    Task.aggregate<{ _id: { user: Types.ObjectId; project: Types.ObjectId }; hours: number }>([
      { $match: match },
      { $group: { _id: { user: "$userId", project: "$projectId" }, hours: hoursSum } },
    ]),
    hoursByProject(match),
    blockedTasks(match, 8),
    reviewQueueSummary(actor, null),
    WeeklyReport.find({ userId: { $in: teamIds }, ...pickWeek(new Date()) }).lean(),
  ]);

  const projectsById = new Map(byProject.map((project) => [project.id, project]));
  const late = new Date() > submissionDeadline();
  return {
    // One row per person, one series per project: the stacked bar.
    hoursByMember: {
      series: byProject.map((project) => ({ key: project.id, name: project.name, color: project.color })),
      rows: team.map((member) => {
        const row: Record<string, string | number> = { label: member.name };
        for (const entry of perMember.filter((item) => String(item._id.user) === String(member._id))) {
          if (projectsById.has(String(entry._id.project))) row[String(entry._id.project)] = round(entry.hours);
        }
        return row;
      }),
    },
    byProject,
    blockers,
    queue,
    compliance: team.map((member) => {
      const report = currentReports.find((item) => String(item.userId) === String(member._id));
      const submitted = Boolean(report && SUBMITTED_STATUSES.includes(report.status));
      return {
        id: String(member._id),
        name: member.name,
        avatarColor: member.avatarColor,
        status: (report?.status ?? null) as ReportStatus | null,
        submitted,
        late: !submitted && late,
      };
    }),
  };
}

const pickWeek = (date: Date) => {
  const week = isoWeekOf(date);
  return { isoYear: week.isoYear, isoWeek: week.isoWeek };
};

/** The Manager's department: everything past the Team Lead, plus their leads' own submitted work. */
export async function managerDashboard(actor: Actor, range: DateRange) {
  if (actor.role !== "MANAGER" || !actor.departmentId) throw forbidden();
  const departmentId = oid(actor.departmentId);
  const visible = await visibleTasksFilter(actor);
  const match = { $and: [visible, { departmentId, ...inRange(range) }] };
  const rangeReports = { departmentId, weekStart: { $gte: storedDay(range.from), $lte: storedDay(range.to) } };

  const [byProject, perUser, trend, queue, funnelRows, health, projects, leads] = await Promise.all([
    hoursByProject(match),
    Task.aggregate<{ _id: Types.ObjectId; hours: number }>([{ $match: match }, { $group: { _id: "$userId", hours: hoursSum } }]),
    weeklyTrend({ $and: [visible, { departmentId }] }, range.to),
    reviewQueueSummary(actor, null),
    WeeklyReport.aggregate<{ _id: ReportStatus; count: number }>([
      { $match: rangeReports },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Task.aggregate<{ _id: Types.ObjectId; hours: number; contributors: Types.ObjectId[]; blocked: number }>([
      { $match: match },
      {
        $group: {
          _id: "$projectId",
          hours: hoursSum,
          contributors: { $addToSet: "$userId" },
          blocked: { $sum: { $cond: [{ $eq: ["$status", "Blocked"] }, 1, 0] } },
        },
      },
    ]),
    Project.find({ departmentId }).select("name color status").sort({ name: 1 }).lean(),
    User.find({ departmentId, role: "TEAM_LEAD", isActive: true }).select("name").lean(),
  ]);

  // Each person's hours count towards their Team Lead's team. A lead's own hours count too.
  const people = await peopleNames(perUser.map((row) => row._id));
  const leadOf = (userId: string) => {
    const person = people.get(userId);
    if (!person) return null;
    if (person.role === "TEAM_LEAD") return userId;
    if (person.role === "DEVELOPER") return person.reportsTo ? String(person.reportsTo) : null;
    return null;
  };
  const workload = leads.map((lead) => ({
    label: `${lead.name}'s team`,
    hours: round(
      perUser.filter((row) => leadOf(String(row._id)) === String(lead._id)).reduce((sum, row) => sum + row.hours, 0),
    ),
  }));

  const count = (statuses: ReportStatus[]) =>
    funnelRows.filter((row) => statuses.includes(row._id)).reduce((sum, row) => sum + row.count, 0);
  const healthById = new Map(health.map((row) => [String(row._id), row]));
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
      const row = healthById.get(String(project._id));
      return {
        id: String(project._id),
        name: project.name,
        color: project.color,
        status: project.status,
        hours: round(row?.hours ?? 0),
        contributors: row?.contributors.length ?? 0,
        blocked: row?.blocked ?? 0,
      };
    }),
  };
}

/** The CEO's view. Every number here comes from fully approved work only. */
export async function ceoDashboard(actor: Actor, selectedDepartmentId: string | null, range: DateRange) {
  if (actor.role !== "CEO") throw forbidden();
  const scope = scopeFor(actor, selectedDepartmentId);
  const approved = { reportStatus: "MANAGER_APPROVED" as const };
  const match = { ...approved, ...scope, ...inRange(range) };
  const now = new Date();
  const week = isoWeekOf(now);
  const monthsStart = storedDay(format(subMonths(localDay(range.to), TREND_MONTHS - 1), "yyyy-MM-01"));

  const [byProject, byDepartment, perUser, monthly, turnaround, headcount, departments, approvedThisWeek, pendingAcks, activeProjects] =
    await Promise.all([
      hoursByProject(match),
      // The comparison always shows every department, whatever the switcher says.
      Task.aggregate<{ _id: Types.ObjectId; hours: number }>([
        { $match: { ...approved, ...inRange(range) } },
        { $group: { _id: "$departmentId", hours: hoursSum } },
      ]),
      Task.aggregate<{ _id: Types.ObjectId; hours: number }>([{ $match: match }, { $group: { _id: "$userId", hours: hoursSum } }]),
      Task.aggregate<{ _id: Date; hours: number }>([
        { $match: { ...approved, ...scope, date: { $gte: monthsStart } } },
        { $group: { _id: { $dateTrunc: { date: "$date", unit: "month" } }, hours: hoursSum } },
        { $sort: { _id: 1 } },
      ]),
      WeeklyReport.aggregate<{ _id: null; total: number; lead: number; count: number }>([
        {
          $match: {
            ...scope,
            status: "MANAGER_APPROVED",
            submittedAt: { $ne: null },
            managerApprovedAt: { $gte: storedDay(range.from), $lte: addDays(storedDay(range.to), 1) },
          },
        },
        {
          $group: {
            _id: null,
            total: { $avg: { $subtract: ["$managerApprovedAt", "$submittedAt"] } },
            lead: {
              $avg: {
                $cond: [{ $ne: ["$leadApprovedAt", null] }, { $subtract: ["$leadApprovedAt", "$submittedAt"] }, null],
              },
            },
            count: { $sum: 1 },
          },
        },
      ] as PipelineStage[]),
      User.aggregate<{ _id: Role; count: number }>([
        { $match: { ...scope, isActive: true, role: { $ne: "CEO" } } },
        { $group: { _id: "$role", count: { $sum: 1 } } },
      ]),
      Department.find({ status: "Active" }).select("name color").sort({ name: 1 }).lean(),
      WeeklyReport.countDocuments({ ...scope, status: "MANAGER_APPROVED", managerApprovedAt: { $gte: week.weekStart } }),
      WeeklyReport.countDocuments({ ...scope, currentApproverId: oid(actor.id), status: "SUBMITTED" }),
      Project.countDocuments({ ...scope, status: "Active" }),
    ]);

  const people = await peopleNames(perUser.map((row) => row._id));
  const leadIds = new Set<string>();
  const teamOf = (userId: string) => {
    const person = people.get(userId);
    if (!person) return null;
    if (person.role === "TEAM_LEAD") return userId;
    if (person.role === "DEVELOPER" && person.reportsTo) return String(person.reportsTo);
    return "managers";
  };
  const teamHours = new Map<string, number>();
  for (const row of perUser) {
    const team = teamOf(String(row._id));
    if (!team) continue;
    if (team !== "managers") leadIds.add(team);
    teamHours.set(team, (teamHours.get(team) ?? 0) + row.hours);
  }
  const leads = await peopleNames([...leadIds].map(oid));
  const departmentHours = new Map(byDepartment.map((row) => [String(row._id), row.hours]));
  const hours = (milliseconds: number | undefined) => (milliseconds ? round(milliseconds / 3_600_000) : null);
  const projectMap = await projectNames(byProject.map((row) => oid(row.id)));
  const departmentNames = new Map(departments.map((department) => [String(department._id), department.name]));

  return {
    kpis: {
      approvedHours: round(byProject.reduce((sum, row) => sum + row.hours, 0)),
      approvedThisWeek,
      pendingAcks,
      headcount: headcount.reduce((sum, row) => sum + row.count, 0),
      activeProjects,
      turnaroundHours: hours(turnaround[0]?.total),
    },
    byProject,
    byDepartment: departments.map((department) => ({
      id: String(department._id),
      label: department.name,
      color: department.color,
      hours: round(departmentHours.get(String(department._id)) ?? 0),
      selected: selectedDepartmentId === String(department._id),
    })),
    byTeam: [...teamHours]
      .map(([team, value]) => ({
        label: team === "managers" ? "Managers" : `${leads.get(team)?.name ?? "Unknown"}'s team`,
        hours: round(value),
      }))
      .sort((a, b) => b.hours - a.hours),
    monthly: Array.from({ length: TREND_MONTHS }, (_, index) => {
      const month = subMonths(localDay(range.to), TREND_MONTHS - 1 - index);
      const key = format(month, "yyyy-MM");
      const row = monthly.find((item) => dayString(item._id).startsWith(key));
      return { label: format(month, "MMM"), hours: round(row?.hours ?? 0) };
    }),
    portfolio: byProject.map((row) => {
      const project = projectMap.get(row.id);
      return {
        ...row,
        status: project?.status ?? "",
        department: departmentNames.get(String(project?.departmentId)) ?? "",
      };
    }),
    turnaround: {
      reports: turnaround[0]?.count ?? 0,
      totalHours: hours(turnaround[0]?.total),
      leadHours: hours(turnaround[0]?.lead),
    },
    headcount: (["MANAGER", "TEAM_LEAD", "DEVELOPER"] as const).map((role) => ({
      role: ROLE_LABELS[role],
      count: headcount.find((row) => row._id === role)?.count ?? 0,
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
  const rows = await WeeklyReport.aggregate<{
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    isoWeek: number;
    entry: { action: string; byUserId: Types.ObjectId; at: Date };
  }>([
    { $match: { $and: [await openableReportsFilter(actor), scopeFor(actor, selectedDepartmentId)] } },
    { $project: { userId: 1, isoWeek: 1, entry: "$approvalTrail" } },
    { $unwind: "$entry" },
    { $sort: { "entry.at": -1 } },
    { $limit: limit },
  ]);
  const people = await peopleNames(rows.flatMap((row) => [row.userId, row.entry.byUserId]));
  return rows.map((row) => {
    const actorName = people.get(String(row.entry.byUserId))?.name ?? "Someone";
    const ownerName = people.get(String(row.userId))?.name ?? "someone";
    const own = String(row.userId) === String(row.entry.byUserId);
    return {
      id: `${row._id}-${row.entry.at.toISOString()}`,
      reportId: String(row._id),
      text: `${actorName} ${ACTIVITY_VERBS[row.entry.action] ?? "updated"} ${own ? "" : `${ownerName}'s `}week ${row.isoWeek}`,
      at: row.entry.at.toISOString(),
      avatarColor: people.get(String(row.entry.byUserId))?.avatarColor ?? "slate",
      actorName,
    };
  });
}

export { REPORT_STATUS_LABELS };
