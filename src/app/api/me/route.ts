import { NextResponse } from "next/server";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { User } from "@/models";
import { updateProfileSchema } from "@/validators/user";

export const GET = authedRoute(async ({ user }) => NextResponse.json({ data: user }));

export const PATCH = authedRoute(async ({ req, user }) => {
  const { name } = await parseBody(req, updateProfileSchema);
  await User.updateOne({ _id: user.id }, { name });
  return NextResponse.json({ data: { name } });
});
