import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/api/handler";
import { auditOverview } from "@/lib/audit/service";

export const GET = authedRoute(async ({ user, selectedDepartmentId }) =>
  NextResponse.json({ data: await auditOverview(user, selectedDepartmentId) }),
);
