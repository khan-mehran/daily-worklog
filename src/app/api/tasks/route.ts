import { NextResponse } from "next/server";
import { authedRoute, parseBody, parseQuery } from "@/lib/api/handler";
import { createTask, listMyTasks } from "@/lib/tasks/service";
import { createTaskSchema, dateRangeSchema } from "@/validators/task";

// Always the caller's own tasks. The range is capped, so the list is bounded without paging.
export const GET = authedRoute(async ({ req, user }) => {
  const { from, to } = parseQuery(req, dateRangeSchema);
  return NextResponse.json({ data: await listMyTasks(user, from, to) });
});

export const POST = authedRoute(async ({ req, user }) => {
  const task = await createTask(user, await parseBody(req, createTaskSchema));
  return NextResponse.json({ data: { id: String(task._id) } }, { status: 201 });
});
