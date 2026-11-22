import { createHmac, timingSafeEqual } from "node:crypto";

// Microsoft Entra ID sign-in (OpenID Connect authorization code flow with PKCE). Microsoft proves
// who the person is; the User table decides whether they have an account and what their role is.
// Only accounts from the tenant in ENTRA_TENANT_ID may sign in.

export const ENTRA_AUTHORITY = "https://login.microsoftonline.com";
export const ENTRA_SCOPES = "openid profile email";
export const ENTRA_LOGIN_PATH = "/api/auth/sso/entra/login";
export const ENTRA_CALLBACK_PATH = "/api/auth/sso/entra/callback";
export const OAUTH_COOKIE = "getl_oauth";
export const OAUTH_COOKIE_PATH = "/api/auth/sso/entra";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TICKET_TTL_MS = 60_000;

export interface EntraSettings {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  redirectUri: string;
  appUrl: string;
}

const env = (name: string) => (process.env[name] ?? "").trim();

/** Null when Microsoft sign-in is not (fully) configured. */
export function entraSettings(): EntraSettings | null {
  const clientId = env("ENTRA_CLIENT_ID");
  const clientSecret = env("ENTRA_CLIENT_SECRET");
  const tenantId = env("ENTRA_TENANT_ID").toLowerCase();
  const appUrl = env("APP_URL") || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  if (!clientId || !clientSecret || !env("AUTH_SECRET")) return null;
  // A real tenant id is required: "common" or "organizations" would let any Microsoft customer in.
  if (!GUID.test(tenantId)) return null;
  try {
    const redirect = new URL(env("ENTRA_REDIRECT_URI") || new URL(ENTRA_CALLBACK_PATH, appUrl));
    if (redirect.pathname !== ENTRA_CALLBACK_PATH || redirect.search || redirect.hash) return null;
    return { clientId, clientSecret, tenantId, redirectUri: redirect.toString(), appUrl: redirect.origin };
  } catch {
    return null;
  }
}

const mac = (value: string) => createHmac("sha256", env("AUTH_SECRET")).update(value).digest("base64url");

/** Packs a value into a tamper-proof string, signed with AUTH_SECRET. */
export function seal(value: object): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

export function unseal<T>(raw: string | undefined | null): T | null {
  const [payload, signature] = (raw ?? "").split(".");
  if (!payload || !signature || !env("AUTH_SECRET")) return null;
  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * A one-minute pass that turns a finished Microsoft sign-in into an Auth.js session. Only this
 * server can make one, so the "microsoft" provider in ./index.ts can trust the user id inside.
 */
export const issueSignInTicket = (userId: string, now = Date.now()) =>
  seal({ purpose: "entra-sign-in", userId, expiresAt: now + TICKET_TTL_MS });

export function userIdFromTicket(ticket: unknown, now = Date.now()) {
  if (typeof ticket !== "string") return null;
  const value = unseal<{ purpose?: string; userId?: string; expiresAt?: number }>(ticket);
  if (value?.purpose !== "entra-sign-in" || typeof value.userId !== "string") return null;
  return typeof value.expiresAt === "number" && value.expiresAt > now ? value.userId : null;
}

export interface EntraIdentity {
  email: string;
  name: string;
}

/**
 * Checks the ID token claims and returns who signed in, or null.
 *
 * The token comes straight from Microsoft's token endpoint over TLS (confidential client + PKCE),
 * so per OIDC Core 3.1.3.7 the TLS server validation stands in for a signature check. The claims
 * are still checked.
 */
export function identityFromIdToken(
  settings: EntraSettings,
  idToken: string,
  expectedNonce: string,
  now = Date.now(),
): EntraIdentity | null {
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const tenantId = String(claims.tid ?? "").toLowerCase();
  const valid =
    claims.aud === settings.clientId &&
    claims.nonce === expectedNonce &&
    typeof claims.exp === "number" &&
    claims.exp > Math.floor(now / 1000) &&
    tenantId === settings.tenantId &&
    claims.iss === `${ENTRA_AUTHORITY}/${tenantId}/v2.0`;
  if (!valid) return null;

  const email = String(claims.email ?? claims.preferred_username ?? claims.upn ?? "")
    .trim()
    .toLowerCase();
  if (!email.includes("@")) return null;
  const name = String(claims.name ?? "").trim() || email.split("@")[0]!;
  return { email, name };
}

/** Only same-site paths, so a crafted link can't send someone elsewhere after sign-in. */
export function safeCallbackPath(value: string | null | undefined) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : "/dashboard";
}
