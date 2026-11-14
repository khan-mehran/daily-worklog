import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

/** Formats a stored yyyy-mm-dd day. It's a calendar day, so no timezone conversion applies. */
export function formatDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, month! - 1, date!).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "Mon 2 Nov" for a stored yyyy-mm-dd day. */
export function formatWeekday(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, month! - 1, date!).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "2 Nov – 8 Nov 2026" for a week. */
export function formatWeekRange(weekStart: string, weekEnd: string) {
  return `${formatDay(weekStart).replace(/ \d{4}$/, "")} – ${formatDay(weekEnd)}`;
}

export const formatHours = (hours: number) =>
  `${Number.isInteger(hours) ? hours : hours.toFixed(2).replace(/0$/, "")}h`;

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
