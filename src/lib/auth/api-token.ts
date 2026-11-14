import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { conflict, notFound } from "@/lib/api/errors";
import { ApiToken } from "@/models";
import { loadActiveUser } from "./session";

export const TOKEN_PREFIX = "wlk_";
const MAX_TOKENS_PER_USER = 10;
/** lastUsedAt is only for display, so it's written at most this often. */
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000;

export const hashApiToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function listApiTokens(userId: string) {
  const tokens = await ApiToken.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).lean();
  return tokens.map((token) => ({
    id: String(token._id),
    name: token.name,
    prefix: token.prefix,
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
  }));
}

/** Creates a token and returns it in full. This is the only time the full token is available. */
export async function createApiToken(userId: string, name: string) {
  if ((await ApiToken.countDocuments({ userId: new Types.ObjectId(userId) })) >= MAX_TOKENS_PER_USER) {
    throw conflict(`You can keep up to ${MAX_TOKENS_PER_USER} tokens. Revoke one first.`);
  }
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const record = await ApiToken.create({
    userId,
    name,
    tokenHash: hashApiToken(token),
    prefix: token.slice(0, TOKEN_PREFIX.length + 6),
  });
  return { id: String(record._id), token };
}

export async function revokeApiToken(userId: string, id: Types.ObjectId) {
  const deleted = await ApiToken.findOneAndDelete({ _id: id, userId: new Types.ObjectId(userId) });
  if (!deleted) throw notFound();
}

/** The active user behind an `Authorization: Bearer wlk_...` header, or null. */
export async function userFromBearer(header: string | null) {
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token?.startsWith(TOKEN_PREFIX)) return null;
  const record = await ApiToken.findOne({ tokenHash: hashApiToken(token) }).lean();
  if (!record) return null;
  const user = await loadActiveUser(String(record.userId));
  if (!user) return null;
  if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await ApiToken.updateOne({ _id: record._id }, { lastUsedAt: new Date() });
  }
  return user;
}
