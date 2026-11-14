import { NextResponse } from "next/server";
import { authedRoute } from "@/lib/api/handler";
import { activityFeed } from "@/lib/dashboards/service";

export const GET = authedRoute(async ({ user, selectedDepartmentId }) =>
  NextResponse.json({ data: await activityFeed(user, selectedDepartmentId) }),
);
