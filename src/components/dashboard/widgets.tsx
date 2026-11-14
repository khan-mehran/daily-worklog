"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Activity, BarChart3, ClipboardCheck, OctagonAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useDateRange } from "@/components/layout/date-range";
import { Avatar, Card, ColorDot, EmptyState, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api-client";
import { cn, formatDay, formatHours } from "@/lib/utils";

/** Fetches one dashboard for the top bar's date range. The CEO's switcher applies server-side. */
export function useDashboard<T>(kind: "developer" | "lead" | "manager" | "ceo") {
  const { range } = useDateRange();
  return useQuery({
    queryKey: ["dashboard", kind, range.from, range.to],
    queryFn: () => api<T>(`/api/dashboard/${kind}?from=${range.from}&to=${range.to}`),
  });
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-muted text-xs">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold", tone)}>{value}</p>
      {hint ? <p className="text-muted mt-0.5 text-xs">{hint}</p> : null}
    </Card>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">{children}</div>;
}

export function KpiSkeleton() {
  return (
    <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4" role="status" aria-label="Loading">
      {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-20 rounded-xl" />)}
    </div>
  );
}

export function ChartCard({
  title,
  description,
  empty,
  emptyIcon = BarChart3,
  emptyText = "Nothing to show for this date range.",
  className,
  children,
}: {
  title: string;
  description?: string;
  empty?: boolean;
  emptyIcon?: LucideIcon;
  emptyText?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <h2 className="font-semibold">{title}</h2>
      {description ? <p className="text-muted text-sm">{description}</p> : null}
      <div className="mt-3">
        {empty ? <EmptyState icon={emptyIcon} title="No data yet" description={emptyText} /> : children}
      </div>
    </Card>
  );
}

export function DashboardSkeleton() {
  return (
    <>
      <KpiSkeleton />
      <div className="grid gap-4 lg:grid-cols-2" role="status" aria-label="Loading charts">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </>
  );
}

export function DashboardError({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <Card>
      <EmptyState
        icon={BarChart3}
        title="Couldn't load the dashboard"
        description={message ?? "Check your connection and try again."}
        action={
          <button type="button" className="text-primary font-medium underline" onClick={onRetry}>
            Try again
          </button>
        }
      />
    </Card>
  );
}

export interface BlockerItem {
  id: string;
  date: string;
  details: string;
  reportId: string;
  person: string;
  project: { name: string; color: string };
}

export function BlockersList({ items, showPerson }: { items: BlockerItem[]; showPerson?: boolean }) {
  return (
    <ChartCard title="Blockers" empty={items.length === 0} emptyIcon={OctagonAlert} emptyText="No blocked tasks in this range.">
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="border-l-danger rounded-lg border border-l-4 px-3 py-2">
            <Link href={`/reports/${item.reportId}`} className="block hover:underline">
              <p className="line-clamp-2 text-sm">{item.details}</p>
            </Link>
            <p className="text-muted mt-1 flex flex-wrap items-center gap-x-2 text-xs">
              {showPerson ? <span className="font-medium">{item.person}</span> : null}
              <span className="flex items-center gap-1">
                <ColorDot color={item.project.color} />
                {item.project.name}
              </span>
              <span>{formatDay(item.date)}</span>
            </p>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

export interface QueueSummary {
  count: number;
  items: { id: string; person: string; isoWeek: number; hours: number; blocked: number; submittedAt: string | null }[];
}

export function PendingReviews({ queue }: { queue: QueueSummary }) {
  return (
    <ChartCard
      title={`Pending reviews (${queue.count})`}
      empty={queue.count === 0}
      emptyIcon={ClipboardCheck}
      emptyText="Nothing is waiting for you."
    >
      <ul className="divide-y">
        {queue.items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 py-2.5 text-sm">
            <Link href={`/reports/${item.id}`} className="min-w-0 flex-1 hover:underline">
              <span className="font-medium">{item.person}</span>
              <span className="text-muted"> · week {item.isoWeek}</span>
            </Link>
            {item.blocked ? <span className="text-danger text-xs font-semibold">{item.blocked} blocked</span> : null}
            <span className="text-muted">{formatHours(item.hours)}</span>
          </li>
        ))}
      </ul>
      {queue.count > queue.items.length ? (
        <Link href="/reviews" className="text-primary mt-2 inline-block text-sm font-medium underline">
          See all {queue.count}
        </Link>
      ) : null}
    </ChartCard>
  );
}

interface ActivityItem {
  id: string;
  reportId: string;
  text: string;
  at: string;
  avatarColor: string;
  actorName: string;
}

export function ActivityFeed() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "activity"],
    queryFn: () => api<ActivityItem[]>("/api/dashboard/activity"),
  });
  return (
    <ChartCard title="Recent activity" empty={!isLoading && !data?.length} emptyIcon={Activity} emptyText="Submissions and approvals will appear here.">
      {isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading activity">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <ul className="space-y-3">
          {data?.map((item) => (
            <li key={item.id} className="flex items-start gap-3 text-sm">
              <Avatar name={item.actorName} color={item.avatarColor} className="size-7 text-[10px]" />
              <div>
                <Link href={`/reports/${item.reportId}`} className="hover:underline">
                  {item.text}
                </Link>
                <p className="text-muted text-xs">{formatDistanceToNow(new Date(item.at), { addSuffix: true })}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
