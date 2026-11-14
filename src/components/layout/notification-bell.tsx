"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, apiRequest, type Paginated } from "@/lib/api-client";
import type { NotificationRow } from "@/lib/notifications/serialise";
import { cn } from "@/lib/utils";

const POLL_MS = 30_000;
const LATEST_KEY = ["notifications", "latest"];

/**
 * Live notifications: Server-Sent Events while the stream is up, and polling every 30 seconds
 * whenever it isn't. A new notification also refreshes the work it's about.
 */
function useLiveNotifications(initialUnread: number) {
  const queryClient = useQueryClient();
  const [unread, setUnread] = useState(initialUnread);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/notifications/stream");
    source.addEventListener("open", () => setStreaming(true));
    source.addEventListener("error", () => setStreaming(false));
    source.addEventListener("unread", (event) => {
      setUnread(JSON.parse((event as MessageEvent).data).count);
    });
    source.addEventListener("notification", (event) => {
      const notification = JSON.parse((event as MessageEvent).data) as NotificationRow;
      toast(notification.title, { description: notification.message });
      for (const key of ["notifications", "review-queue", "reports", "tasks", "dashboard"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    });
    return () => source.close();
  }, [queryClient]);

  const latest = useQuery({
    queryKey: LATEST_KEY,
    queryFn: () => apiRequest<Paginated<NotificationRow> & { meta: { unread: number } }>("/api/notifications?limit=8"),
    refetchInterval: streaming ? false : POLL_MS,
  });
  useEffect(() => {
    if (latest.data) setUnread(latest.data.meta.unread);
  }, [latest.data]);

  return { unread, latest };
}

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { unread, latest } = useLiveNotifications(initialUnread);

  const markRead = useMutation({
    mutationFn: (body: { all: true } | { ids: string[] }) =>
      api("/api/notifications/read", { method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const items = latest.data?.data ?? [];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell />
          {unread > 0 ? (
            <span className="bg-accent text-accent-foreground absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="bg-surface z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="font-semibold">Notifications</p>
            {unread > 0 ? (
              <button
                type="button"
                className="text-primary flex items-center gap-1 text-xs font-medium"
                onClick={() => markRead.mutate({ all: true })}
              >
                <CheckCheck className="size-3.5" aria-hidden />
                Mark all as read
              </button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto p-1">
            {latest.isLoading ? (
              <p className="text-muted p-4 text-sm">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-muted p-6 text-center text-sm">You&apos;re all caught up.</p>
            ) : (
              items.map((item) => (
                <DropdownMenu.Item
                  key={item.id}
                  onSelect={() => {
                    if (!item.readAt) markRead.mutate({ ids: [item.id] });
                    if (item.link) router.push(item.link);
                  }}
                  className="data-[highlighted]:bg-subtle flex cursor-pointer gap-3 rounded-lg px-3 py-2.5 outline-none"
                >
                  <span
                    aria-hidden
                    className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.readAt ? "bg-transparent" : "bg-accent")}
                  />
                  <span className="min-w-0">
                    <span className={cn("block text-sm", !item.readAt && "font-semibold")}>
                      {item.title}
                      {item.readAt ? null : <span className="sr-only"> (unread)</span>}
                    </span>
                    <span className="text-muted line-clamp-2 block text-xs">{item.message}</span>
                    <span className="text-muted mt-0.5 block text-[11px]">
                      {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                    </span>
                  </span>
                </DropdownMenu.Item>
              ))
            )}
          </div>
          <DropdownMenu.Item asChild className="data-[highlighted]:bg-subtle block border-t px-4 py-2.5 text-center text-sm font-medium outline-none">
            <Link href="/notifications">View all notifications</Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
