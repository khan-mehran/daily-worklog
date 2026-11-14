"use client";

import Link from "next/link";
import { CategoryBars, DonutChart, StackedBars, TrendLine } from "@/components/charts/lazy-dashboard-charts";
import { ReportStatusBadge } from "@/components/reports/report-status-badge";
import { Avatar, Badge, Card, ColorDot } from "@/components/ui/misc";
import type { ReportStatus } from "@/lib/constants";
import { cn, formatHours } from "@/lib/utils";
import {
  ActivityFeed,
  BlockersList,
  ChartCard,
  DashboardError,
  DashboardSkeleton,
  Kpi,
  KpiRow,
  PendingReviews,
  useDashboard,
  type BlockerItem,
  type QueueSummary,
} from "./widgets";

interface ProjectHours {
  id: string;
  name: string;
  color: string;
  hours: number;
  tasks: number;
}

const donutData = (rows: ProjectHours[]) => rows.map((row) => ({ name: row.name, value: row.hours, color: row.color }));

/** Up to `limit` named slices, with the rest folded into "Other" so colours never repeat. */
function topWithOther(rows: ProjectHours[], limit = 8): ProjectHours[] {
  if (rows.length <= limit) return rows;
  const rest = rows.slice(limit - 1);
  return [
    ...rows.slice(0, limit - 1),
    {
      id: "other",
      name: "Other",
      color: "slate",
      hours: Math.round(rest.reduce((sum, row) => sum + row.hours, 0) * 100) / 100,
      tasks: rest.reduce((sum, row) => sum + row.tasks, 0),
    },
  ];
}

interface DeveloperData {
  kpis: { hours: number; tasks: number; completionRate: number; blocked: number; streak: number };
  byProject: ProjectHours[];
  series: { unit: "day" | "week"; points: { label: string; hours: number; completed: number }[] };
  trend: { label: string; hours: number }[];
  blockers: BlockerItem[];
  timeline: { id: string; isoWeek: number; weekStart: string; status: ReportStatus; hours: number }[];
}

export function DeveloperDashboard({ compact }: { compact?: boolean }) {
  const { data, isLoading, isError, refetch } = useDashboard<DeveloperData>("developer");
  if (isLoading) return <DashboardSkeleton />;
  if (isError || !data) return <DashboardError onRetry={() => refetch()} />;
  const noWork = data.kpis.tasks === 0;
  return (
    <>
      <KpiRow>
        <Kpi label="Hours" value={formatHours(data.kpis.hours)} />
        <Kpi label="Tasks" value={data.kpis.tasks} hint={`${data.kpis.completionRate}% completed`} />
        <Kpi label="Current streak" value={`${data.kpis.streak} day${data.kpis.streak === 1 ? "" : "s"}`} hint="Working days with a task" />
        <Kpi label="Blocked" value={data.kpis.blocked} tone={data.kpis.blocked ? "text-danger" : undefined} />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Hours by project" empty={noWork}>
          <DonutChart title="Hours by project" data={donutData(topWithOther(data.byProject))} />
        </ChartCard>
        <ChartCard title={`Tasks completed per ${data.series.unit}`} empty={noWork}>
          <CategoryBars
            title="Tasks completed"
            unit="tasks"
            data={data.series.points.map((point) => ({ label: point.label, value: point.completed }))}
          />
        </ChartCard>
        <ChartCard title="Weekly hours" description="The last 8 weeks" empty={data.trend.every((week) => week.hours === 0)}>
          <TrendLine title="Weekly hours" data={data.trend.map((week) => ({ label: week.label, value: week.hours }))} />
        </ChartCard>
        <ChartCard title="My reports" description="The last 6 weeks" empty={data.timeline.length === 0} emptyText="Your weekly reports appear here once you log work.">
          <ol className="space-y-2">
            {data.timeline.map((week) => (
              <li key={week.id} className="flex items-center gap-3 text-sm">
                <Link href={`/reports/${week.id}`} className="w-20 font-medium hover:underline">
                  Week {week.isoWeek}
                </Link>
                <ReportStatusBadge status={week.status} />
                <span className="text-muted ml-auto">{formatHours(week.hours)}</span>
              </li>
            ))}
          </ol>
        </ChartCard>
        <BlockersList items={data.blockers} />
        {compact ? null : <ActivityFeed />}
      </div>
    </>
  );
}

interface LeadData {
  hoursByMember: { series: { key: string; name: string; color: string }[]; rows: Record<string, string | number>[] };
  byProject: ProjectHours[];
  blockers: BlockerItem[];
  queue: QueueSummary;
  compliance: { id: string; name: string; avatarColor: string; status: ReportStatus | null; submitted: boolean; late: boolean }[];
}

export function LeadDashboard() {
  const { data, isLoading, isError, refetch } = useDashboard<LeadData>("lead");
  if (isLoading) return <DashboardSkeleton />;
  if (isError || !data) return <DashboardError onRetry={() => refetch()} />;
  const teamHours = data.byProject.reduce((sum, row) => sum + row.hours, 0);
  const submitted = data.compliance.filter((member) => member.submitted).length;
  const late = data.compliance.filter((member) => member.late).length;
  return (
    <>
      <p className="text-muted-on-background mb-3 text-sm">
        Your team&apos;s numbers include only weeks they have submitted to you.
      </p>
      <KpiRow>
        <Kpi label="Team hours" value={formatHours(Math.round(teamHours * 100) / 100)} />
        <Kpi label="Pending reviews" value={data.queue.count} tone={data.queue.count ? "text-info" : undefined} />
        <Kpi label="Submitted this week" value={`${submitted} of ${data.compliance.length}`} hint={late ? `${late} late` : undefined} />
        <Kpi label="Team blockers" value={data.blockers.length} tone={data.blockers.length ? "text-danger" : undefined} />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Hours per person and project" className="lg:col-span-2" empty={teamHours === 0}>
          <StackedBars title="Hours per person and project" rows={data.hoursByMember.rows} series={data.hoursByMember.series} />
        </ChartCard>
        <ChartCard title="Project distribution" empty={teamHours === 0}>
          <DonutChart title="Team hours by project" data={donutData(topWithOther(data.byProject))} />
        </ChartCard>
        <PendingReviews queue={data.queue} />
        <ChartCard title="Submission compliance" description="This week. Late means not submitted by Friday 4 PM." empty={data.compliance.length === 0} emptyText="Nobody reports to you yet.">
          <ul className="divide-y">
            {data.compliance.map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-2 text-sm">
                <Avatar name={member.name} color={member.avatarColor} className="size-7 text-[10px]" />
                <span className="min-w-0 flex-1 truncate">{member.name}</span>
                {member.late ? <Badge className="border-danger text-danger">Late</Badge> : null}
                {member.status ? <ReportStatusBadge status={member.status} /> : <Badge className="text-muted">Nothing logged</Badge>}
              </li>
            ))}
          </ul>
        </ChartCard>
        <BlockersList items={data.blockers} showPerson />
      </div>
      <OwnWorkSection />
    </>
  );
}

function OwnWorkSection() {
  return (
    <section className="mt-8" aria-labelledby="own-work">
      <h2 id="own-work" className="mb-3 text-lg font-bold">Your own work</h2>
      <DeveloperDashboard compact />
    </section>
  );
}

interface ManagerData {
  kpis: { hours: number; pending: number; thisWeek: number; weekOverWeek: number | null };
  byProject: ProjectHours[];
  workload: { label: string; hours: number }[];
  trend: { label: string; hours: number }[];
  queue: QueueSummary;
  funnel: { label: string; count: number }[];
  projectHealth: { id: string; name: string; color: string; status: string; hours: number; contributors: number; blocked: number }[];
}

export function ManagerDashboard() {
  const { data, isLoading, isError, refetch } = useDashboard<ManagerData>("manager");
  if (isLoading) return <DashboardSkeleton />;
  if (isError || !data) return <DashboardError onRetry={() => refetch()} />;
  const maxFunnel = Math.max(1, ...data.funnel.map((step) => step.count));
  const wow = data.kpis.weekOverWeek;
  return (
    <>
      <p className="text-muted-on-background mb-3 text-sm">
        Department numbers include developers&apos; work once their Team Lead has approved it.
      </p>
      <KpiRow>
        <Kpi label="Department hours" value={formatHours(data.kpis.hours)} />
        <Kpi label="This week" value={formatHours(data.kpis.thisWeek)} hint={wow === null ? undefined : `${wow >= 0 ? "+" : ""}${wow}% on last week`} />
        <Kpi label="Pending reviews" value={data.kpis.pending} tone={data.kpis.pending ? "text-info" : undefined} />
        <Kpi label="Blocked tasks" value={data.projectHealth.reduce((sum, row) => sum + row.blocked, 0)} />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Hours by project" empty={data.kpis.hours === 0}>
          <CategoryBars title="Hours by project" data={data.byProject.map((row) => ({ label: row.name, value: row.hours, color: row.color }))} />
        </ChartCard>
        <ChartCard title="Workload by Team Lead" empty={data.workload.every((row) => row.hours === 0)}>
          <CategoryBars title="Hours per team" data={data.workload.map((row) => ({ label: row.label, value: row.hours }))} />
        </ChartCard>
        <ChartCard title="Approval funnel" description="Reports for weeks in this range">
          <ul className="space-y-3">
            {data.funnel.map((step) => (
              <li key={step.label} className="text-sm">
                <div className="mb-1 flex justify-between">
                  <span>{step.label}</span>
                  <span className="font-semibold">{step.count}</span>
                </div>
                <div className="bg-subtle h-2 rounded-full" aria-hidden>
                  <div className="bg-primary h-2 rounded-full" style={{ width: `${(step.count / maxFunnel) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </ChartCard>
        <PendingReviews queue={data.queue} />
        <ChartCard title="Week over week" description="Department hours, last 8 weeks" empty={data.trend.every((week) => week.hours === 0)}>
          <TrendLine title="Department hours per week" data={data.trend.map((week) => ({ label: week.label, value: week.hours }))} />
        </ChartCard>
        <ActivityFeed />
        <ChartCard title="Project health" className="lg:col-span-2" empty={data.projectHealth.length === 0} emptyText="Your department has no projects yet.">
          <ProjectTable rows={data.projectHealth} />
        </ChartCard>
      </div>
      <OwnWorkSection />
    </>
  );
}

function ProjectTable({
  rows,
  showDepartment,
}: {
  rows: { id: string; name: string; color: string; status: string; hours: number; contributors?: number; blocked?: number; tasks?: number; department?: string }[];
  showDepartment?: boolean;
}) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-muted border-b text-xs">
          <tr>
            <th className="py-2 pr-3 font-medium">Project</th>
            {showDepartment ? <th className="px-3 py-2 font-medium">Department</th> : null}
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Hours</th>
            {rows[0]?.contributors !== undefined ? <th className="px-3 py-2 text-right font-medium">Contributors</th> : null}
            {rows[0]?.blocked !== undefined ? <th className="px-3 py-2 text-right font-medium">Blocked</th> : null}
            {rows[0]?.tasks !== undefined ? <th className="px-3 py-2 text-right font-medium">Tasks</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b last:border-0">
              <td className="py-2.5 pr-3">
                <Link href={`/projects/${row.id}`} className="flex items-center gap-2 hover:underline">
                  <ColorDot color={row.color} />
                  {row.name}
                </Link>
              </td>
              {showDepartment ? <td className="px-3 py-2.5">{row.department}</td> : null}
              <td className="text-muted px-3 py-2.5">{row.status}</td>
              <td className="px-3 py-2.5 text-right font-semibold">{formatHours(row.hours)}</td>
              {row.contributors !== undefined ? <td className="px-3 py-2.5 text-right">{row.contributors}</td> : null}
              {row.blocked !== undefined ? (
                <td className={cn("px-3 py-2.5 text-right", row.blocked ? "text-danger font-semibold" : "")}>{row.blocked}</td>
              ) : null}
              {row.tasks !== undefined ? <td className="px-3 py-2.5 text-right">{row.tasks}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface CeoData {
  kpis: { approvedHours: number; approvedThisWeek: number; pendingAcks: number; headcount: number; activeProjects: number; turnaroundHours: number | null };
  byProject: ProjectHours[];
  byDepartment: { id: string; label: string; color: string; hours: number; selected: boolean }[];
  byTeam: { label: string; hours: number }[];
  monthly: { label: string; hours: number }[];
  portfolio: (ProjectHours & { status: string; department: string })[];
  turnaround: { reports: number; totalHours: number | null; leadHours: number | null };
  headcount: { role: string; count: number }[];
}

const asDays = (hours: number | null) => (hours === null ? "—" : hours < 48 ? `${hours}h` : `${Math.round((hours / 24) * 10) / 10} days`);

export function CeoDashboard() {
  const { data, isLoading, isError, refetch } = useDashboard<CeoData>("ceo");
  if (isLoading) return <DashboardSkeleton />;
  if (isError || !data) return <DashboardError onRetry={() => refetch()} />;
  const empty = data.kpis.approvedHours === 0;
  return (
    <>
      <p className="text-muted-on-background mb-3 text-sm">Every number here comes from fully approved work only.</p>
      <h2 className="mb-2 text-sm font-semibold">This week at a glance</h2>
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Approved hours (range)" value={formatHours(data.kpis.approvedHours)} />
        <Kpi label="Reports approved this week" value={data.kpis.approvedThisWeek} />
        <Kpi label="Waiting for you" value={data.kpis.pendingAcks} tone={data.kpis.pendingAcks ? "text-info" : undefined} hint="Managers' weeks" />
        <Kpi label="People" value={data.kpis.headcount} />
        <Kpi label="Active projects" value={data.kpis.activeProjects} />
        <Kpi label="Average approval time" value={asDays(data.kpis.turnaroundHours)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Hours by project" empty={empty}>
          <DonutChart title="Approved hours by project" data={donutData(topWithOther(data.byProject))} />
        </ChartCard>
        <ChartCard title="Top projects" description="Ranked by approved hours" empty={empty}>
          <CategoryBars
            title="Approved hours by project"
            data={data.byProject.slice(0, 10).map((row) => ({ label: row.name, value: row.hours, color: row.color }))}
          />
        </ChartCard>
        <ChartCard title="Departments compared" description="Always every department, whatever the switcher says">
          <CategoryBars title="Approved hours by department" data={data.byDepartment.map((row) => ({ label: row.label, value: row.hours, color: row.color }))} />
        </ChartCard>
        <ChartCard title="Hours by team" empty={data.byTeam.length === 0}>
          <CategoryBars title="Approved hours by team" data={data.byTeam.map((row) => ({ label: row.label, value: row.hours }))} />
        </ChartCard>
        <ChartCard title="Monthly trend" description="The last 6 months" empty={data.monthly.every((month) => month.hours === 0)}>
          <TrendLine title="Approved hours per month" data={data.monthly.map((month) => ({ label: month.label, value: month.hours }))} />
        </ChartCard>
        <Card className="p-5">
          <h2 className="font-semibold">Approval turnaround</h2>
          <p className="text-muted text-sm">Reports given final approval in this range</p>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-muted text-xs">Submit to final</dt>
              <dd className="text-xl font-bold">{asDays(data.turnaround.totalHours)}</dd>
            </div>
            <div>
              <dt className="text-muted text-xs">Submit to lead</dt>
              <dd className="text-xl font-bold">{asDays(data.turnaround.leadHours)}</dd>
            </div>
            <div>
              <dt className="text-muted text-xs">Reports</dt>
              <dd className="text-xl font-bold">{data.turnaround.reports}</dd>
            </div>
          </dl>
          <h3 className="mt-6 mb-2 font-semibold">Headcount by role</h3>
          <ul className="space-y-1.5 text-sm">
            {data.headcount.map((row) => (
              <li key={row.role} className="flex justify-between">
                <span>{row.role}</span>
                <span className="font-semibold">{row.count}</span>
              </li>
            ))}
          </ul>
        </Card>
        <ChartCard title="Project portfolio" className="lg:col-span-2" empty={empty}>
          <ProjectTable rows={data.portfolio} showDepartment />
        </ChartCard>
        <ActivityFeed />
      </div>
    </>
  );
}
