import { NextResponse } from "next/server";
import { authedRoute, idParam } from "@/lib/api/handler";
import { deleteTemplate } from "@/lib/tasks/service";

export const DELETE = authedRoute<{ id: string }>(async ({ params, user }) => {
  await deleteTemplate(user, idParam(params.id));
  return NextResponse.json({ data: { id: params.id } });
});
