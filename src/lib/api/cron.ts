import { timingSafeEqual } from "node:crypto";

/** Whether a scheduler sent `Authorization: Bearer <CRON_SECRET>`. Never true without a secret set. */
export function hasCronSecret(header: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
