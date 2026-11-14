import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { createApiToken, listApiTokens } from "@/lib/auth/api-token";

const createTokenSchema = z.object({
  name: z.string({ error: "Name the token" }).trim().min(1, "Name the token").max(60),
});

export const GET = authedRoute(async ({ user }) =>
  NextResponse.json({ data: await listApiTokens(user.id) }),
);

/** The response carries the full token. It is never shown again. */
export const POST = authedRoute(async ({ req, user }) => {
  const { name } = await parseBody(req, createTokenSchema);
  return NextResponse.json({ data: await createApiToken(user.id, name) }, { status: 201 });
});
