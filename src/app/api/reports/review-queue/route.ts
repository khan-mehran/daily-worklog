import { NextResponse } from "next/server";
import { authedRoute, parseQuery } from "@/lib/api/handler";
import { reviewQueue } from "@/lib/reports/service";
import { reviewQueueQuerySchema } from "@/validators/report";

export const GET = authedRoute(async ({ req, user, selectedDepartmentId }) => {
  const { page, limit } = parseQuery(req, reviewQueueQuerySchema);
  const { reports, total } = await reviewQueue(user, selectedDepartmentId, page, limit);
  return NextResponse.json({ data: reports, meta: { page, limit, total } });
});
