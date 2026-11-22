import { prisma } from "@/lib/db/prisma";

/**
 * Fixed-window counter stored in PostgreSQL, so limits hold across server instances. One atomic
 * upsert, so concurrent requests can't both slip under the limit.
 * Returns true while the key is within its limit.
 */
export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowMs);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "expiresAt")
    VALUES (${key}, 1, ${expiresAt}::timestamptz)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."expiresAt" > ${now}::timestamptz THEN "RateLimit"."count" + 1 ELSE 1 END,
      "expiresAt" = CASE WHEN "RateLimit"."expiresAt" > ${now}::timestamptz THEN "RateLimit"."expiresAt" ELSE ${expiresAt}::timestamptz END
    RETURNING "count"`;
  return (rows[0]?.count ?? 1) <= limit;
}

/** Expired counters are harmless but pile up. The reminders job clears them. */
export async function purgeExpiredRateLimits(now = new Date()) {
  const { count } = await prisma.rateLimit.deleteMany({ where: { expiresAt: { lte: now } } });
  return count;
}
