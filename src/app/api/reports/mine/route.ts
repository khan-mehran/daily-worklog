import { NextResponse } from "next/server";
import { authedRoute, parseQuery } from "@/lib/api/handler";
import { listMyReports } from "@/lib/reports/service";
import { myReportsQuerySchema } from "@/validators/report";

export const GET = authedRoute(async ({ req, user }) => {
  const { page, limit } = parseQuery(req, myReportsQuerySchema);
  const { reports, total } = await listMyReports(user, page, limit);
  return NextResponse.json({ data: reports, meta: { page, limit, total } });
});
