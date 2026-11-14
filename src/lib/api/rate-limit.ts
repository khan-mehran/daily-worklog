import { RateLimit } from "@/models";

/**
 * Fixed-window counter stored in MongoDB, so limits hold across server instances.
 * Returns true while the key is within its limit.
 */
export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = new Date();
  try {
    const entry = await RateLimit.findOneAndUpdate(
      { _id: key },
      [
        {
          $set: {
            count: {
              $cond: [{ $gt: ["$expiresAt", now] }, { $add: ["$count", 1] }, 1],
            },
            expiresAt: {
              $cond: [
                { $gt: ["$expiresAt", now] },
                "$expiresAt",
                new Date(now.getTime() + windowMs),
              ],
            },
          },
        },
      ],
      { upsert: true, new: true, updatePipeline: true },
    ).lean();
    return (entry?.count ?? 1) <= limit;
  } catch (error) {
    // Two first requests can race on the upsert. The loser just retries.
    if ((error as { code?: number }).code === 11000) {
      return consumeRateLimit(key, limit, windowMs);
    }
    throw error;
  }
}
