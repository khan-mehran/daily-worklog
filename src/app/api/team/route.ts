import { NextResponse } from "next/server";
import { authedRoute, parseQuery } from "@/lib/api/handler";
import { listTeam } from "@/lib/team/service";
import { paginationSchema } from "@/validators/common";

export const GET = authedRoute(async ({ req, user, selectedDepartmentId }) => {
  const { page, limit } = parseQuery(req, paginationSchema);
  const { people, total, isoWeek } = await listTeam(user, selectedDepartmentId, page, limit);
  return NextResponse.json({ data: people, meta: { page, limit, total, isoWeek } });
});
