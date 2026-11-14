import { NextResponse } from "next/server";
import { badRequest, tooManyRequests } from "@/lib/api/errors";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { User } from "@/models";
import { changePasswordSchema } from "@/validators/user";

export const POST = authedRoute(async ({ req, user }) => {
  if (!(await consumeRateLimit(`password:${user.id}`, 5, 15 * 60 * 1000))) throw tooManyRequests();
  const { currentPassword, newPassword } = await parseBody(req, changePasswordSchema);
  const record = await User.findById(user.id).select("+passwordHash");
  if (!record || !(await verifyPassword(currentPassword, record.passwordHash))) {
    throw badRequest("Your current password isn't right.", "WRONG_PASSWORD");
  }
  record.passwordHash = await hashPassword(newPassword);
  await record.save();
  return NextResponse.json({ data: { changed: true } });
});
