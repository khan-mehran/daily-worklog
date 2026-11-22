"use client";

import * as Popover from "@radix-ui/react-popover";
import { format, startOfISOWeek, startOfMonth, subDays } from "date-fns";
import { CalendarDays } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";

type Preset = "week" | "7d" | "30d" | "month" | "custom";

interface DateRange {
  preset: Preset;
  from: string;
  to: string;
}

const STORAGE_KEY = "getl-date-range";
const day = (date: Date) => format(date, "yyyy-MM-dd");

const PRESETS: { id: Exclude<Preset, "custom">; label: string; from: (now: Date) => Date }[] = [
  { id: "week", label: "This week", from: (now) => startOfISOWeek(now) },
  { id: "7d", label: "Last 7 days", from: (now) => subDays(now, 6) },
  { id: "30d", label: "Last 30 days", from: (now) => subDays(now, 29) },
  { id: "month", label: "This month", from: (now) => startOfMonth(now) },
];

function rangeForPreset(preset: Exclude<Preset, "custom">): DateRange {
  const now = new Date();
  const definition = PRESETS.find((item) => item.id === preset)!;
  return { preset, from: day(definition.from(now)), to: day(now) };
}

const DateRangeContext = createContext<{
  range: DateRange;
  setRange: (range: DateRange) => void;
} | null>(null);

/** The global date range from the top bar. Dashboards read it through useDateRange. */
export function useDateRange() {
  const context = useContext(DateRangeContext);
  if (!context) throw new Error("useDateRange must be used inside DateRangeProvider");
  return context;
}

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [range, setRangeState] = useState<DateRange>(() => rangeForPreset("week"));

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as DateRange | null;
      if (!stored) return;
      // A preset is re-resolved so "This week" still means this week on a later visit.
      setRangeState(stored.preset === "custom" ? stored : rangeForPreset(stored.preset));
    } catch {
      // Blocked or corrupt storage just means the default range.
    }
  }, []);

  const value = useMemo(
    () => ({
      range,
      setRange(next: DateRange) {
        setRangeState(next);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // The range still applies for this visit.
        }
      },
    }),
    [range],
  );
  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>;
}

export function DateRangePicker() {
  const { range, setRange } = useDateRange();
  const [open, setOpen] = useState(false);
  const label =
    PRESETS.find((preset) => preset.id === range.preset)?.label ?? `${range.from} – ${range.to}`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="secondary" aria-label={`Date range: ${label}`}>
          <CalendarDays />
          <span className="hidden lg:inline">{label}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="bg-surface z-50 w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl border p-3"
        >
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={range.preset === preset.id}
                onClick={() => {
                  setRange(rangeForPreset(preset.id));
                  setOpen(false);
                }}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-sm transition-colors duration-150",
                  range.preset === preset.id
                    ? "bg-primary text-primary-foreground border-transparent font-semibold"
                    : "hover:bg-subtle",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From" htmlFor="range-from">
              <Input
                id="range-from"
                type="date"
                value={range.from}
                max={range.to}
                onChange={(event) =>
                  event.target.value &&
                  setRange({ preset: "custom", from: event.target.value, to: range.to })
                }
              />
            </Field>
            <Field label="To" htmlFor="range-to">
              <Input
                id="range-to"
                type="date"
                value={range.to}
                min={range.from}
                onChange={(event) =>
                  event.target.value &&
                  setRange({ preset: "custom", from: range.from, to: event.target.value })
                }
              />
            </Field>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
