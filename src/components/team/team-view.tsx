"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ReportStatusBadge } from "@/components/reports/report-status-badge";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/pagination";
import { apiRequest, type Paginated } from "@/lib/api-client";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import type { TeamMember } from "@/lib/team/service";
import { cn, formatHours } from "@/lib/utils";

const PAGE_SIZE = 25;

const DESCRIPTIONS: Partial<Record<Role, string>> = {
  TEAM_LEAD: "Your direct reports and their current week.",
  MANAGER: "Everyone in your department and their current week.",
  CEO: "Everyone, or one department with the switcher.",
};

export function TeamView({ role }: { role: Role }) {
  const highlight = useSearchParams().get("highlight");
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["team", page],
    queryFn: () => apiRequest<Paginated<TeamMember> & { meta: { isoWeek: number } }>(`/api/team?page=${page}&limit=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const rows = data?.data ?? [];

  return (
    <>
      <PageHeader title="Team" description={DESCRIPTIONS[role]} />
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5" role="status" aria-label="Loading team">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12" />)}
          </div>
        ) : isError ? (
          <EmptyState
            icon={Users}
            title="Couldn't load your team"
            description="Check your connection and try again."
            action={<Button variant="secondary" onClick={() => refetch()}>Try again</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="Nobody here yet" description="People who report to you will appear here." />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">Week {data?.meta.isoWeek} status for each person</caption>
              <thead className="text-muted border-b text-xs">
                <tr>
                  <th className="px-5 py-3 font-medium">Person</th>
                  <th className="px-3 py-3 font-medium">Reports to</th>
                  <th className="px-3 py-3 font-medium">Week {data?.meta.isoWeek}</th>
                  <th className="px-3 py-3 text-right font-medium">Hours</th>
                  <th className="px-5 py-3 text-right font-medium">Blocked</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((person) => (
                  <tr key={person.id} className={cn("border-b last:border-0", highlight === person.id && "bg-primary/10")}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={person.name} color={person.avatarColor} />
                        <div>
                          <p className="font-medium">{person.name}</p>
                          <p className="text-muted text-xs">{ROLE_LABELS[person.role as Role]}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">{person.reportsTo ?? "—"}</td>
                    <td className="px-3 py-3">
                      {person.status ? (
                        person.hours !== null && person.reportId ? (
                          <Link href={`/reports/${person.reportId}`}>
                            <ReportStatusBadge status={person.status} />
                          </Link>
                        ) : (
                          <ReportStatusBadge status={person.status} />
                        )
                      ) : (
                        <Badge className="text-muted">Nothing logged</Badge>
                      )}
                    </td>
                    {/* Hours show only once the week has reached you. */}
                    <td className="px-3 py-3 text-right font-semibold">
                      {person.hours === null ? <span className="text-muted font-normal" title="Not submitted to you yet">—</span> : formatHours(person.hours)}
                    </td>
                    <td className={cn("px-5 py-3 text-right", person.blocked ? "text-danger font-semibold" : "")}>
                      {person.blocked ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-muted-on-background mt-3 text-xs">
        Hours and blockers show once a week has been submitted to you or has passed through your review.
      </p>
      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.meta.total ?? 0} noun="people" onPageChange={setPage} />
    </>
  );
}
