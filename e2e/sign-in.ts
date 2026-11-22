import type { Browser, Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_URL } from "../playwright.config";
import { issueSignInTicket } from "../src/lib/auth/entra";

// GET List signs people in with Microsoft only, and a browser test can't go through Microsoft. So
// these tests finish a sign-in exactly as the real callback route does after Microsoft has
// vouched for someone: with a one-minute ticket signed with AUTH_SECRET. Nothing in the app is
// switched off or bypassed for tests, and only someone who holds AUTH_SECRET can do this.

const prisma = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });

/** Signs the page in as the seeded user with this email, and opens the dashboard. */
export async function signIn(page: Page, email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const { csrfToken } = await (await page.request.get("/api/auth/csrf")).json();
  await page.request.post("/api/auth/callback/microsoft", {
    form: { csrfToken, ticket: issueSignInTicket(user.id), callbackUrl: "/dashboard" },
  });
  await page.goto("/dashboard");
  await page.waitForURL("**/dashboard");
}

/** A page in its own browser context, signed in as the seeded user with this email. */
export async function signedIn(browser: Browser, email: string) {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  return page;
}
