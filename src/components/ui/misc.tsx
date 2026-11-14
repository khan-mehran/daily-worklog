import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { paletteVar } from "@/lib/constants";
import { cn, initials } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
  // min-w-0 lets a card in a grid shrink, so wide content like a table scrolls inside it.
  return (
    <div
      className={cn(
        "bg-surface min-w-0 rounded-xl border shadow-[0_1px_3px_rgb(60_40_110/0.06)]",
        className,
      )}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("bg-subtle animate-pulse rounded-lg", className)}
      {...props}
    />
  );
}

/** A named colour marker. Always shown beside its name, so identity isn't carried by colour alone. */
export function ColorDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ background: paletteVar(color) }}
    />
  );
}

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

export function Avatar({
  name,
  color,
  className,
}: {
  name: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-surface inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-xs leading-none font-bold tracking-tight",
        className,
      )}
      style={{ borderColor: paletteVar(color) }}
    >
      {initials(name)}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="bg-subtle mb-4 flex size-12 items-center justify-center rounded-xl">
        <Icon className="text-primary size-6" aria-hidden />
      </span>
      <h2 className="font-semibold">{title}</h2>
      <p className="text-muted mt-1 max-w-md text-sm">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-muted-on-background mt-1 text-sm">{description}</p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
