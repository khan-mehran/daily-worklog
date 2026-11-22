import { BarChart3, Check, ClipboardCheck, ListChecks, NotebookPen } from "lucide-react";
import type { ReactNode } from "react";

const FEATURES = [
  { icon: ListChecks, text: "Log your daily tasks in minutes" },
  { icon: ClipboardCheck, text: "Weekly reports, reviewed and approved" },
  { icon: BarChart3, text: "Dashboards for every team and project" },
];

// A stand-in for the product on the brand panel: a day's list, part way through.
const PREVIEW = [
  { label: "Update the vendor onboarding form", done: true },
  { label: "Review lab booking requests", done: true },
  { label: "Prepare the weekly report", done: false },
];

function TaskPreview() {
  return (
    <div aria-hidden className="w-full max-w-sm rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sidebar-heading text-xs font-semibold tracking-wider uppercase">Today</span>
        <span className="bg-highlight text-highlight-foreground rounded-full px-2 py-0.5 text-[11px] font-bold">
          2 of 3 done
        </span>
      </div>
      <ul className="space-y-2">
        {PREVIEW.map((item) => (
          <li key={item.label} className="flex items-center gap-3 rounded-lg bg-white/[0.05] px-3 py-2.5">
            <span
              className={
                item.done
                  ? "bg-sidebar-indicator text-sidebar-deep flex size-5 shrink-0 items-center justify-center rounded-full"
                  : "size-5 shrink-0 rounded-full ring-2 ring-white/25 ring-inset"
              }
            >
              {item.done ? <Check className="size-3.5" strokeWidth={3} /> : null}
            </span>
            <span className={item.done ? "text-sm text-white/50 line-through" : "text-sm font-medium text-white"}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:grid-rows-1">
      {/* Brand panel: a slim header on small screens, the full left half on large ones. */}
      <section className="bg-sidebar-deep text-sidebar-foreground relative isolate flex flex-col overflow-hidden px-6 py-5 lg:px-14 lg:py-12">
        {/* Flat shapes only, to match the rest of the design. */}
        <div aria-hidden className="absolute -top-24 -left-24 -z-10 size-80 rounded-full bg-white/[0.04]" />
        <div aria-hidden className="absolute -top-10 -left-10 -z-10 size-48 rounded-full bg-white/[0.04]" />
        <div aria-hidden className="bg-sidebar absolute -right-32 -bottom-40 -z-10 size-[30rem] rounded-full" />
        <div aria-hidden className="absolute -right-10 bottom-24 -z-10 size-24 rounded-full ring-1 ring-white/10" />

        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/15">
            <NotebookPen className="size-5" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="text-lg font-bold tracking-tight text-white">GET List</p>
            <p className="text-sidebar-heading text-xs font-medium">Gord Employee Task List</p>
          </div>
        </div>

        <div className="hidden flex-1 flex-col justify-center py-10 lg:flex">
          <h2 className="max-w-md text-4xl leading-tight font-bold tracking-tight text-white">
            Your work, <span className="text-sidebar-indicator">written down</span> and seen.
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed">
            Log what you did today, send your week for review and see where every project stands, all in
            one place.
          </p>
          <ul className="mt-8 space-y-3.5">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm font-medium text-white">
                <span className="text-sidebar-indicator flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] ring-1 ring-white/10">
                  <Icon className="size-4" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
          <div className="mt-10">
            <TaskPreview />
          </div>
        </div>

        <p className="text-sidebar-heading hidden text-xs lg:block">
          Developed by <span className="font-semibold text-white">GORD</span>
        </p>
      </section>

      <section className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}
