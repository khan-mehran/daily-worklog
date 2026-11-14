"use client";

// Every chart here follows the same rules: a tooltip, a text legend beside each colour, recessive
// axes and grid, colours that follow the entity (a project keeps its colour everywhere), and a
// thin surface-coloured gap between touching marks. Pages load this module lazily.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { paletteVar } from "@/lib/constants";

const AXIS = {
  tickLine: false,
  tick: { fill: "var(--muted)", fontSize: 12 },
} as const;
const GRID = <CartesianGrid vertical={false} stroke="var(--border)" />;

interface TooltipRow {
  name: string;
  value: number;
  color?: string;
}

function TooltipBox({ title, rows, unit }: { title?: string; rows: TooltipRow[]; unit: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-surface min-w-36 rounded-lg border px-3 py-2 text-xs">
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      {rows.map((row) => (
        <p key={row.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            {row.color ? <span aria-hidden className="size-2 rounded-full" style={{ background: row.color }} /> : null}
            {row.name}
          </span>
          <span className="font-semibold">
            {row.value} {unit}
          </span>
        </p>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string; value?: string }[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs" aria-label="Legend">
      {items.map((item) => (
        <li key={item.name} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full" style={{ background: item.color }} />
          <span>{item.name}</span>
          {item.value ? <span className="text-muted">{item.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

const describe = (title: string, rows: { label: string; value: number }[], unit: string) =>
  `${title}. ${rows.map((row) => `${row.label}: ${row.value} ${unit}`).join(", ")}.`;

export function DonutChart({
  data,
  title,
  unit = "h",
}: {
  data: { name: string; value: number; color: string }[];
  title: string;
  unit?: string;
}) {
  const total = Math.round(data.reduce((sum, row) => sum + row.value, 0) * 100) / 100;
  return (
    <div>
      <div
        role="img"
        aria-label={describe(title, data.map((row) => ({ label: row.name, value: row.value })), unit)}
        className="relative h-56"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((row) => (
                <Cell key={row.name} fill={paletteVar(row.color)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <TooltipBox
                    unit={unit}
                    rows={[
                      {
                        name: String(payload[0].name),
                        value: Number(payload[0].value),
                        color: paletteVar((payload[0].payload as { color: string }).color),
                      },
                    ]}
                  />
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold">{total}{unit}</span>
          <span className="text-muted text-xs">total</span>
        </div>
      </div>
      <Legend items={data.map((row) => ({ name: row.name, color: paletteVar(row.color), value: `${row.value}${unit}` }))} />
    </div>
  );
}

export function CategoryBars({
  data,
  title,
  unit = "h",
  color = "var(--primary)",
  height = 224,
}: {
  data: { label: string; value: number; color?: string }[];
  title: string;
  unit?: string;
  color?: string;
  height?: number;
}) {
  return (
    <div role="img" aria-label={describe(title, data, unit)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -16 }}>
          {GRID}
          <XAxis dataKey="label" {...AXIS} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={8} />
          <YAxis allowDecimals={false} {...AXIS} axisLine={false} />
          <Tooltip
            cursor={{ fill: "var(--subtle)" }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as { label: string; value: number } | undefined;
              return active && point ? <TooltipBox title={point.label} unit={unit} rows={[{ name: title, value: point.value }]} /> : null;
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
            {data.map((row) => (
              <Cell key={row.label} fill={row.color ? paletteVar(row.color) : color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StackedBars({
  rows,
  series,
  title,
  unit = "h",
}: {
  rows: Record<string, string | number>[];
  series: { key: string; name: string; color: string }[];
  title: string;
  unit?: string;
}) {
  const summary = rows.map((row) => ({
    label: String(row.label),
    value: series.reduce((sum, item) => sum + Number(row[item.key] ?? 0), 0),
  }));
  return (
    <div>
      <div role="img" aria-label={describe(title, summary, unit)} className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -16 }}>
            {GRID}
            <XAxis dataKey="label" {...AXIS} axisLine={{ stroke: "var(--border)" }} interval={0} />
            <YAxis allowDecimals={false} {...AXIS} axisLine={false} />
            <Tooltip
              cursor={{ fill: "var(--subtle)" }}
              content={({ active, payload, label }) =>
                active && payload ? (
                  <TooltipBox
                    title={String(label)}
                    unit={unit}
                    rows={payload
                      .filter((entry) => Number(entry.value) > 0)
                      .map((entry) => ({
                        name: String(entry.name),
                        value: Number(entry.value),
                        color: String(entry.color),
                      }))}
                  />
                ) : null
              }
            />
            {series.map((item, index) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                name={item.name}
                stackId="total"
                fill={paletteVar(item.color)}
                stroke="var(--surface)"
                strokeWidth={1}
                maxBarSize={40}
                radius={index === series.length - 1 ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend items={series.map((item) => ({ name: item.name, color: paletteVar(item.color) }))} />
    </div>
  );
}

export function TrendLine({
  data,
  title,
  unit = "h",
  color = "var(--primary)",
}: {
  data: { label: string; value: number }[];
  title: string;
  unit?: string;
  color?: string;
}) {
  return (
    <div role="img" aria-label={describe(title, data, unit)} className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
          {GRID}
          <XAxis dataKey="label" {...AXIS} axisLine={{ stroke: "var(--border)" }} />
          <YAxis allowDecimals={false} {...AXIS} axisLine={false} />
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as { label: string; value: number } | undefined;
              return active && point ? <TooltipBox title={point.label} unit={unit} rows={[{ name: title, value: point.value }]} /> : null;
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 4, fill: color, stroke: "var(--surface)", strokeWidth: 2 }}
            activeDot={{ r: 6, stroke: "var(--surface)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
