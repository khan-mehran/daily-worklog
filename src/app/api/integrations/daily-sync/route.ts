import { NextResponse } from "next/server";
import { tooManyRequests } from "@/lib/api/errors";
import { parseBody, tokenRoute } from "@/lib/api/handler";
import { consumeRateLimit } from "@/lib/api/rate-limit";
import { syncDay } from "@/lib/sync/service";
import { dailySyncSchema } from "@/validators/sync";

const SYNCS_PER_HOUR = 20;

/**
 * The VS Code daily sync (public/worklog-sync.mjs) posts a day's git activity here with a
 * personal API token. Each project becomes one task on the person's Tasks page.
 */
export const POST = tokenRoute(async ({ req, user }) => {
  const input = await parseBody(req, dailySyncSchema);
  if (!(await consumeRateLimit(`sync:${user.id}`, SYNCS_PER_HOUR, 60 * 60 * 1000))) {
    throw tooManyRequests(`You can sync ${SYNCS_PER_HOUR} times an hour. Try again later.`);
  }
  return NextResponse.json({ data: { date: input.date, results: await syncDay(user, input) } });
});
