import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { authedRoute, objectIdParam } from "@/lib/api/handler";
import { getReportDetail } from "@/lib/reports/service";

export const GET = authedRoute<{ id: string }>(async ({ params, user }) => {
  const report = await getReportDetail(user, objectIdParam(params.id));
  if (!report) throw notFound();
  return NextResponse.json({ data: report });
});
