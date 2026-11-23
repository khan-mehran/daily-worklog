import { NextResponse } from "next/server";
import { hasCronSecret } from "@/lib/api/cron";
import { unauthorized } from "@/lib/api/errors";
import { publicRoute } from "@/lib/api/handler";
import { purgeExpiredRateLimits } from "@/lib/api/rate-limit";
import { sendReminders } from "@/lib/reminders/service";
import { autoSubmitReports } from "@/lib/reports/auto-submit";

// Called by a scheduler (vercel.json, or scripts/cron.ts) with `Authorization: Bearer <CRON_SECRET>`.
export const GET = publicRoute(async ({ req }) => {
  if (!hasCronSecret(req.headers.get("authorization"))) throw unauthorized();
  await purgeExpiredRateLimits();
  // Auto-submit first, so nobody is reminded about a week that has just been sent for them.
  const submitted = await autoSubmitReports();
  return NextResponse.json({ data: { ...submitted, ...(await sendReminders()) } });
});
