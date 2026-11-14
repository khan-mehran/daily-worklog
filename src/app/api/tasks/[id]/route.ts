import { NextResponse } from "next/server";
import { authedRoute, objectIdParam, parseBody } from "@/lib/api/handler";
import { deleteTask, updateTask } from "@/lib/tasks/service";
import { updateTaskSchema } from "@/validators/task";

type Params = { id: string };

export const PATCH = authedRoute<Params>(async ({ req, params, user }) => {
  const task = await updateTask(user, objectIdParam(params.id), await parseBody(req, updateTaskSchema));
  return NextResponse.json({ data: { id: String(task._id) } });
});

export const DELETE = authedRoute<Params>(async ({ params, user }) => {
  await deleteTask(user, objectIdParam(params.id));
  return NextResponse.json({ data: { id: params.id } });
});
