import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  ENTRA_AUTHORITY,
  ENTRA_SCOPES,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  entraSettings,
  safeCallbackPath,
  seal,
} from "@/lib/auth/entra";

export const dynamic = "force-dynamic";

const random = () => randomBytes(32).toString("base64url");

// Starts the Microsoft sign-in. The one-time values (PKCE verifier, state, nonce) and where to go
// afterwards travel in a short-lived, signed, http-only cookie.
export async function GET(request: NextRequest) {
  const settings = entraSettings();
  if (!settings) return NextResponse.redirect(new URL("/login?error=not_configured", request.url));

  const verifier = random();
  const state = random();
  const nonce = random();
  const callbackUrl = safeCallbackPath(request.nextUrl.searchParams.get("callbackUrl"));

  const params = new URLSearchParams({
    client_id: settings.clientId,
    response_type: "code",
    redirect_uri: settings.redirectUri,
    response_mode: "query",
    scope: ENTRA_SCOPES,
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  });

  const response = NextResponse.redirect(
    `${ENTRA_AUTHORITY}/${settings.tenantId}/oauth2/v2.0/authorize?${params}`,
  );
  response.cookies.set(OAUTH_COOKIE, seal({ verifier, state, nonce, callbackUrl }), {
    httpOnly: true,
    sameSite: "lax",
    secure: settings.appUrl.startsWith("https://"),
    path: OAUTH_COOKIE_PATH,
    maxAge: 600,
  });
  return response;
}
