"use client";

import { format } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { PageHeader } from "@/components/ui/misc";
import type { MyTask } from "@/lib/tasks/service";
import { cn } from "@/lib/utils";
import { DailyTab } from "./daily-tab";
import { MonthlyTab } from "./monthly-tab";
import { TaskDialog } from "./task-dialog";
import { WeeklyTab } from "./weekly-tab";

const TABS = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** True when a key press belongs to a text field rather than to the page. */
export function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(
    element &&
      (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)),
  );
}

export function TasksView({ exportSlot }: { exportSlot?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = (TABS.find((item) => item.id === searchParams.get("tab"))?.id ?? "daily") as TabId;
  const date = searchParams.get("date") ?? format(new Date(), "yyyy-MM-dd");
  const [month, setMonth] = useState(() => new Date());
  const [dialog, setDialog] = useState<{ open: boolean; task?: MyTask }>({ open: false });

  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      router.replace(`${pathname}?${params}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // N opens Add Task. Other pages send ?new=1 here when N is pressed.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setDialog({ open: true });
      setParams({ new: null });
    }
  }, [searchParams, setParams]);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || document.querySelector("[role=dialog]")) return;
      event.preventDefault();
      setDialog({ open: true });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = TABS[(index + step + TABS.length) % TABS.length]!;
    setParams({ tab: next.id });
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Log your work each day, then submit the week for review."
        actions={exportSlot}
      />
      <div role="tablist" aria-label="Task views" className="bg-subtle mb-5 inline-flex rounded-lg p-1">
        {TABS.map((item, index) => (
          <button
            key={item.id}
            id={`tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setParams({ tab: item.id })}
            onKeyDown={(event) => onTabKey(event, index)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-150",
              tab === item.id ? "bg-surface text-foreground shadow-none" : "text-muted hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "daily" ? (
          <DailyTab
            date={date}
            onDateChange={(next) => setParams({ date: next })}
            onAdd={() => setDialog({ open: true })}
            onEdit={(task) => setDialog({ open: true, task })}
          />
        ) : tab === "weekly" ? (
          <WeeklyTab />
        ) : (
          <MonthlyTab month={month} onMonthChange={setMonth} />
        )}
      </div>
      <TaskDialog
        open={dialog.open}
        task={dialog.task}
        date={date}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
      />
    </>
  );
}
