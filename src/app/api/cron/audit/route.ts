import { NextResponse } from "next/server";
import { hasCronSecret } from "@/lib/api/cron";
import { unauthorized } from "@/lib/api/errors";
import { publicRoute } from "@/lib/api/handler";
import { runDueAudits } from "@/lib/audit/service";

// Many projects take a while, one after another.
export const maxDuration = 300;

/**
 * The daily dependency audit. Called by a scheduler (vercel.json, or scripts/cron.ts) with
 * `Authorization: Bearer <CRON_SECRET>`. It only checks projects that are due, so calling it
 * every hour is fine. `?force=1` checks every project now.
 */
export const GET = publicRoute(async ({ req }) => {
  if (!hasCronSecret(req.headers.get("authorization"))) throw unauthorized();
  const force = req.nextUrl.searchParams.get("force") === "1";
  return NextResponse.json({ data: await runDueAudits(new Date(), { force }) });
});
