"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/misc";

const loading = () => <Skeleton className="h-56" role="status" aria-label="Loading chart" />;

// Recharts is large, so dashboards load it after the page itself.
export const DonutChart = dynamic(() => import("./dashboard-charts").then((mod) => mod.DonutChart), { ssr: false, loading });
export const CategoryBars = dynamic(() => import("./dashboard-charts").then((mod) => mod.CategoryBars), { ssr: false, loading });
export const StackedBars = dynamic(() => import("./dashboard-charts").then((mod) => mod.StackedBars), { ssr: false, loading });
export const TrendLine = dynamic(() => import("./dashboard-charts").then((mod) => mod.TrendLine), { ssr: false, loading });
