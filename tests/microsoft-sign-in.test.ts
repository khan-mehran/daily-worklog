import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  entraSettings,
  identityFromIdToken,
  issueSignInTicket,
  safeCallbackPath,
  seal,
  unseal,
  userIdFromTicket,
  type EntraSettings,
} from "@/lib/auth/entra";

const TENANT = "11111111-2222-3333-4444-555555555555";
const settings: EntraSettings = {
  clientId: "client-id",
  clientSecret: "client-secret",
  tenantId: TENANT,
  redirectUri: "http://localhost:3000/api/auth/sso/entra/callback",
  appUrl: "http://localhost:3000",
};

const idToken = (claims: Record<string, unknown>) =>
  `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
const goodClaims = () => ({
  aud: settings.clientId,
  nonce: "nonce-1",
  exp: Math.floor(Date.now() / 1000) + 600,
  tid: TENANT,
  iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  email: "Priya.Nair@Example.com",
  name: "Priya Nair",
});

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret-of-reasonable-length");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("ENTRA_CLIENT_ID", settings.clientId);
  vi.stubEnv("ENTRA_CLIENT_SECRET", settings.clientSecret);
  vi.stubEnv("ENTRA_TENANT_ID", TENANT);
  vi.stubEnv("ENTRA_REDIRECT_URI", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("entraSettings", () => {
  it("builds the redirect URI from APP_URL when none is given", () => {
    expect(entraSettings()).toEqual(settings);
  });

  it("is off until every credential is set", () => {
    vi.stubEnv("ENTRA_CLIENT_SECRET", "");
    expect(entraSettings()).toBeNull();
  });

  it("refuses multi-tenant values, which would let any Microsoft customer in", () => {
    vi.stubEnv("ENTRA_TENANT_ID", "common");
    expect(entraSettings()).toBeNull();
  });

  it("refuses a redirect URI that isn't this app's callback", () => {
    vi.stubEnv("ENTRA_REDIRECT_URI", "http://localhost:3000/somewhere-else");
    expect(entraSettings()).toBeNull();
  });
});

describe("identityFromIdToken", () => {
  it("returns the lower-cased email and name for a valid token", () => {
    expect(identityFromIdToken(settings, idToken(goodClaims()), "nonce-1")).toEqual({
      email: "priya.nair@example.com",
      name: "Priya Nair",
    });
  });

  it("falls back to preferred_username when there is no email claim", () => {
    const claims = { ...goodClaims(), email: undefined, preferred_username: "p.nair@example.com" };
    const identity = identityFromIdToken(settings, idToken(claims), "nonce-1");
    expect(identity?.email).toBe("p.nair@example.com");
  });

  it.each([
    ["another app's token", { aud: "someone-else" }],
    ["another tenant", { tid: "99999999-2222-3333-4444-555555555555" }],
    ["a forged issuer", { iss: "https://evil.example/v2.0" }],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 10 }],
    ["a replayed nonce", { nonce: "old-nonce" }],
    ["no usable email", { email: "not-an-email" }],
  ])("rejects %s", (_label, override) => {
    expect(identityFromIdToken(settings, idToken({ ...goodClaims(), ...override }), "nonce-1")).toBeNull();
  });

  it("rejects something that isn't a token", () => {
    expect(identityFromIdToken(settings, "garbage", "nonce-1")).toBeNull();
  });
});

describe("signed values", () => {
  it("round-trips a value and rejects a tampered one", () => {
    const sealed = seal({ state: "abc" });
    expect(unseal(sealed)).toEqual({ state: "abc" });
    const [payload, signature] = sealed.split(".");
    const forged = Buffer.from(JSON.stringify({ state: "xyz" })).toString("base64url");
    expect(unseal(`${forged}.${signature}`)).toBeNull();
    expect(unseal(`${payload}.`)).toBeNull();
    expect(unseal(undefined)).toBeNull();
  });

  it("rejects values signed with a different secret", () => {
    const sealed = seal({ state: "abc" });
    vi.stubEnv("AUTH_SECRET", "a-different-secret");
    expect(unseal(sealed)).toBeNull();
  });
});

describe("sign-in tickets", () => {
  const userId = "0d5f2f0e-6d8c-4a53-9f0e-2c9a4b6f7a11";

  it("carries the user id for one minute", () => {
    const now = Date.now();
    const ticket = issueSignInTicket(userId, now);
    expect(userIdFromTicket(ticket, now + 30_000)).toBe(userId);
    expect(userIdFromTicket(ticket, now + 61_000)).toBeNull();
  });

  it("can't be forged from another signed value", () => {
    expect(userIdFromTicket(seal({ userId, expiresAt: Date.now() + 60_000 }))).toBeNull();
    expect(userIdFromTicket("nonsense")).toBeNull();
    expect(userIdFromTicket(undefined)).toBeNull();
  });
});

describe("safeCallbackPath", () => {
  it("keeps same-site paths and replaces anything else with the dashboard", () => {
    expect(safeCallbackPath("/projects?status=Active")).toBe("/projects?status=Active");
    expect(safeCallbackPath("https://evil.example")).toBe("/dashboard");
    expect(safeCallbackPath("//evil.example")).toBe("/dashboard");
    expect(safeCallbackPath("/\\evil.example")).toBe("/dashboard");
    expect(safeCallbackPath(null)).toBe("/dashboard");
  });
});
