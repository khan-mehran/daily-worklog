import { NextResponse } from "next/server";
import { authedRoute, objectIdParam, parseBody } from "@/lib/api/handler";
import { updateProjectMembers } from "@/lib/projects/service";
import { updateMembersSchema } from "@/validators/project";

export const POST = authedRoute<{ id: string }>(async ({ req, params, user }) => {
  const id = objectIdParam(params.id);
  await updateProjectMembers(user, id, await parseBody(req, updateMembersSchema));
  return NextResponse.json({ data: { id: params.id } });
});
