import { NextResponse } from "next/server";
import { authedRoute, parseQuery } from "@/lib/api/handler";
import { leadDashboard } from "@/lib/dashboards/service";
import { dashboardQuerySchema } from "@/validators/dashboard";

export const GET = authedRoute(async ({ req, user }) => {
  const range = parseQuery(req, dashboardQuerySchema);
  return NextResponse.json({ data: await leadDashboard(user, range) });
});
