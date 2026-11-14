"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface WeekHours {
  label: string;
  hours: number;
}

function ChartTooltip({
  active,
  point,
  unit,
}: {
  active?: boolean;
  point?: WeekHours;
  unit: string;
}) {
  if (!active || !point) return null;
  return (
    <div className="bg-surface rounded-lg border px-3 py-2 text-xs">
      <p className="font-semibold">{point.label}</p>
      <p className="text-muted mt-0.5">
        {point.hours} {unit}
      </p>
    </div>
  );
}

export default function WeeklyHoursChart({
  data,
  fill,
  title,
  unit = "hours",
}: {
  data: WeekHours[];
  fill: string;
  /** Names the chart for screen readers. */
  title: string;
  unit?: string;
}) {
  const summary = data.map((week) => `${week.label}: ${week.hours} hours`).join(", ");
  return (
    <div role="img" aria-label={`${title}. ${summary}.`} className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: "var(--subtle)" }}
            content={({ active, payload }) => (
              <ChartTooltip
                active={active}
                unit={unit}
                point={payload?.[0]?.payload as WeekHours | undefined}
              />
            )}
          />
          <Bar dataKey="hours" fill={fill} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
