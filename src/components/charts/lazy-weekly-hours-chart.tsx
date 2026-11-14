"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/misc";

// Recharts is large, so pages load it only when they actually have a chart to draw.
export const LazyWeeklyHoursChart = dynamic(() => import("./weekly-hours-chart"), {
  ssr: false,
  loading: () => <Skeleton className="h-56" role="status" aria-label="Loading chart" />,
});
