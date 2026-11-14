import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/api/errors";
import { publicRoute } from "@/lib/api/handler";
import { sendReminders } from "@/lib/reminders/service";

function hasCronSecret(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Called by a scheduler (vercel.json, or scripts/cron.ts) with `Authorization: Bearer <CRON_SECRET>`.
export const GET = publicRoute(async ({ req }) => {
  if (!hasCronSecret(req.headers.get("authorization"))) throw unauthorized();
  return NextResponse.json({ data: await sendReminders() });
});
