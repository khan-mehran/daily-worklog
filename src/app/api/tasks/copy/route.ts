import { NextResponse } from "next/server";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { copyPreviousDay } from "@/lib/tasks/service";
import { copyTasksSchema } from "@/validators/task";

export const POST = authedRoute(async ({ req, user }) => {
  const { date } = await parseBody(req, copyTasksSchema);
  return NextResponse.json({ data: await copyPreviousDay(user, date) });
});
