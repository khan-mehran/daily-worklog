import { NextResponse } from "next/server";
import { authedRoute, objectIdParam } from "@/lib/api/handler";
import { revokeApiToken } from "@/lib/auth/api-token";

export const DELETE = authedRoute<{ id: string }>(async ({ params, user }) => {
  await revokeApiToken(user.id, objectIdParam(params.id));
  return NextResponse.json({ data: { id: params.id } });
});
