import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/api/errors";
import { publicRoute } from "@/lib/api/handler";
import { purgeExpiredRateLimits } from "@/lib/api/rate-limit";
import { sendReminders } from "@/lib/reminders/service";
import { autoSubmitReports } from "@/lib/reports/auto-submit";

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
  await purgeExpiredRateLimits();
  // Auto-submit first, so nobody is reminded about a week that has just been sent for them.
  const submitted = await autoSubmitReports();
  return NextResponse.json({ data: { ...submitted, ...(await sendReminders()) } });
});
