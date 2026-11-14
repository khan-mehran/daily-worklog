import { NextResponse } from "next/server";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { User } from "@/models";
import { preferencesSchema } from "@/validators/user";

export const PATCH = authedRoute(async ({ req, user }) => {
  const patch = await parseBody(req, preferencesSchema);
  const $set = Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [`preferences.${key}`, value]),
  );
  const updated = await User.findByIdAndUpdate(user.id, { $set }, { new: true, runValidators: true })
    .select("preferences")
    .lean();
  return NextResponse.json({ data: updated?.preferences });
});
