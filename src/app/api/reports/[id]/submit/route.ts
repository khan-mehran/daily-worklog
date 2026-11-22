import { NextResponse } from "next/server";
import { authedRoute, idParam } from "@/lib/api/handler";
import { transitionReport } from "@/lib/reports/service";

export const POST = authedRoute<{ id: string }>(async ({ params, user }) => {
  const report = await transitionReport(user, idParam(params.id), "submit");
  return NextResponse.json({ data: { id: params.id, status: report.status } });
});
