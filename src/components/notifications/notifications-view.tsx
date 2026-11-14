"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/pagination";
import { api, apiRequest, type Paginated } from "@/lib/api-client";
import type { NotificationRow } from "@/lib/notifications/serialise";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

export function NotificationsView() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["notifications", "page", page, unreadOnly],
    queryFn: () =>
      apiRequest<Paginated<NotificationRow> & { meta: { unread: number } }>(
        `/api/notifications?page=${page}&limit=${PAGE_SIZE}${unreadOnly ? "&unread=true" : ""}`,
      ),
    placeholderData: keepPreviousData,
  });
  const markRead = useMutation({
    mutationFn: (body: { all: true } | { ids: string[] }) => api("/api/notifications/read", { method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const rows = data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description={data ? `${data.meta.unread} unread` : undefined}
        actions={
          data?.meta.unread ? (
            <Button variant="secondary" onClick={() => markRead.mutate({ all: true })}>
              <CheckCheck />
              Mark all as read
            </Button>
          ) : null
        }
      />
      <div className="bg-subtle mb-4 inline-flex rounded-lg p-1" role="group" aria-label="Show">
        {[
          { value: false, label: "All" },
          { value: true, label: "Unread" },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={unreadOnly === option.value}
            onClick={() => {
              setUnreadOnly(option.value);
              setPage(1);
            }}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium",
              unreadOnly === option.value ? "bg-surface" : "text-muted",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5" role="status" aria-label="Loading notifications">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12" />)}
          </div>
        ) : isError ? (
          <EmptyState
            icon={Bell}
            title="Couldn't load notifications"
            description="Check your connection and try again."
            action={<Button variant="secondary" onClick={() => refetch()}>Try again</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={unreadOnly ? "No unread notifications" : "No notifications yet"}
            description="Submissions, approvals and requested changes will show up here."
          />
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start gap-3 px-5 py-3.5">
                <span aria-hidden className={cn("mt-2 size-2 shrink-0 rounded-full", row.readAt ? "bg-transparent" : "bg-accent")} />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", !row.readAt && "font-semibold")}>
                    {row.link ? (
                      <Link href={row.link} className="hover:underline" onClick={() => !row.readAt && markRead.mutate({ ids: [row.id] })}>
                        {row.title}
                      </Link>
                    ) : (
                      row.title
                    )}
                    {row.readAt ? null : <span className="sr-only"> (unread)</span>}
                  </p>
                  <p className="text-muted text-sm">{row.message}</p>
                  <p className="text-muted mt-0.5 text-xs">
                    {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
                  </p>
                </div>
                {row.readAt ? null : (
                  <Button variant="ghost" size="sm" onClick={() => markRead.mutate({ ids: [row.id] })}>
                    Mark as read
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.meta.total ?? 0} noun="notifications" onPageChange={setPage} />
    </>
  );
}
