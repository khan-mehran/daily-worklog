import { addDays, format, getISOWeek, getISOWeekYear, startOfISOWeek } from "date-fns";

/** The calendar day of `date` as midnight UTC, which is how task days are stored. */
export function toUtcDay(date: Date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

export function isoWeekOf(date: Date) {
  const start = startOfISOWeek(date);
  return {
    isoYear: getISOWeekYear(date),
    isoWeek: getISOWeek(date),
    weekStart: toUtcDay(start),
    weekEnd: toUtcDay(addDays(start, 6)),
  };
}

/** A yyyy-mm-dd day as a local Date, for calendar maths. */
export function localDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year!, month! - 1, date!);
}

/** A yyyy-mm-dd day as stored: midnight UTC. */
export const storedDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** A stored day back to yyyy-mm-dd. */
export const dayString = (date: Date) => date.toISOString().slice(0, 10);

export const isoWeekOfDay = (day: string) => isoWeekOf(localDay(day));

export const todayString = () => format(new Date(), "yyyy-MM-dd");
