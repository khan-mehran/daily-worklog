import { NextResponse } from "next/server";
import { forbidden } from "@/lib/api/errors";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { deleteBitbucketConnection, getBitbucketConnection, saveBitbucketConnection } from "@/lib/bitbucket/connection";
import { bitbucketConnectionSchema } from "@/validators/bitbucket";

/** The department's Bitbucket connection, for its manager. The token is never part of the answer. */
export const GET = authedRoute(async ({ user }) => {
  const connection = await getBitbucketConnection(user);
  if (!connection) throw forbidden();
  return NextResponse.json({ data: connection });
});

export const PUT = authedRoute(async ({ req, user }) => {
  await saveBitbucketConnection(user, await parseBody(req, bitbucketConnectionSchema));
  return NextResponse.json({ data: await getBitbucketConnection(user) });
});

export const DELETE = authedRoute(async ({ user }) => {
  await deleteBitbucketConnection(user);
  return NextResponse.json({ data: { connected: false } });
});
