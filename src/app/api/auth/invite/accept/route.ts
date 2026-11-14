import { NextResponse } from "next/server";
import { tooManyRequests } from "@/lib/api/errors";
import { parseBody, publicRoute } from "@/lib/api/handler";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { acceptInvite } from "@/lib/users/service";
import { acceptInviteSchema } from "@/validators/auth";

export const POST = publicRoute(async ({ req }) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!(await consumeRateLimit(`invite:ip:${ip}`, 20, 15 * 60 * 1000))) throw tooManyRequests();
  const { token, password } = await parseBody(req, acceptInviteSchema);
  return NextResponse.json({ data: await acceptInvite(token, password) });
});
