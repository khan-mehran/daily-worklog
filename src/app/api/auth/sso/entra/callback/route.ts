import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { signIn } from "@/lib/auth";
import {
  ENTRA_AUTHORITY,
  ENTRA_SCOPES,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  entraSettings,
  identityFromIdToken,
  issueSignInTicket,
  safeCallbackPath,
  unseal,
  type EntraSettings,
} from "@/lib/auth/entra";
import { resolveMicrosoftSignIn } from "@/lib/users/access";

export const dynamic = "force-dynamic";

async function exchangeCode(settings: EntraSettings, code: string, verifier: string) {
  try {
    const response = await fetch(`${ENTRA_AUTHORITY}/${settings.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: settings.redirectUri,
        code_verifier: verifier,
        scope: ENTRA_SCOPES,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as {
      id_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !data.id_token) {
      console.error(
        `[auth] Microsoft token exchange failed: ${response.status} ${data.error ?? ""} ${data.error_description ?? ""}`,
      );
      return null;
    }
    return data.id_token;
  } catch (error) {
    console.error("[auth] Microsoft token endpoint is unreachable", error);
    return null;
  }
}

// Completes the Microsoft sign-in: checks the one-time values, exchanges the code, and asks
// resolveMicrosoftSignIn what this person may do. Someone approved gets a session. A first-time
// visitor gets an account that waits for a Super Admin, and goes back to the sign-in page with a
// message saying so.
export async function GET(request: NextRequest) {
  const settings = entraSettings();
  const cookieJar = await cookies();
  const saved = unseal<{ verifier: string; state: string; nonce: string; callbackUrl?: string }>(
    cookieJar.get(OAUTH_COOKIE)?.value,
  );
  cookieJar.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });

  const finish = (path: string) => NextResponse.redirect(new URL(path, settings?.appUrl ?? request.url));
  if (!settings) return finish("/login?error=not_configured");
  if (!saved) return finish("/login?error=sso_expired");

  const query = request.nextUrl.searchParams;
  const code = query.get("code");
  if (query.get("error") || !code || query.get("state") !== saved.state) {
    return finish("/login?error=sso_failed");
  }

  const idToken = await exchangeCode(settings, code, saved.verifier);
  if (!idToken) return finish("/login?error=sso_failed");

  const identity = identityFromIdToken(settings, idToken, saved.nonce);
  if (!identity) return finish("/login?error=sso_tenant");

  let access;
  try {
    access = await resolveMicrosoftSignIn(identity);
  } catch (error) {
    console.error("[auth] could not look up the account after Microsoft sign-in", error);
    return finish("/login?error=sso_failed");
  }
  if (access.outcome !== "signed-in") return finish(`/login?status=${access.outcome}`);

  try {
    await signIn("microsoft", { ticket: issueSignInTicket(access.user.id), redirect: false });
  } catch (error) {
    console.error("[auth] could not start a session after Microsoft sign-in", error);
    return finish("/login?error=sso_failed");
  }
  return finish(safeCallbackPath(saved.callbackUrl));
}
