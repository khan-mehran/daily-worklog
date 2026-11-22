import type { EmailMessage, EmailService } from "./types";

const SEND_URL = "https://api.sendgrid.com/v3/mail/send";
const TIMEOUT_MS = 30_000;

const env = (name: string) => (process.env[name] ?? "").trim();

export const isEmailConfigured = () => Boolean(env("SENDGRID_API_KEY") && env("SENDGRID_FROM_EMAIL"));

/** Accepts "someone@example.com" or "Someone <someone@example.com>". */
export function parseAddress(address: string): { email: string; name?: string } {
  const match = address.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (!match) return { email: address.trim() };
  const name = match[1]!.replace(/^"|"$/g, "");
  return name ? { email: match[2]!.trim(), name } : { email: match[2]!.trim() };
}

/** Outgoing email through SendGrid's Mail Send API. */
class SendGridEmailService implements EmailService {
  async send(message: EmailMessage) {
    if (!isEmailConfigured()) {
      throw new Error("Email is not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL.");
    }
    const response = await fetch(SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env("SENDGRID_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to.trim() }] }],
        // SENDGRID_FROM_EMAIL must be a sender verified in the SendGrid account.
        from: parseAddress(env("SENDGRID_FROM_EMAIL")),
        subject: message.subject,
        // SendGrid requires text/plain before text/html.
        content: [
          { type: "text/plain", value: message.text },
          { type: "text/html", value: message.html },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`SendGrid answered ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
  }
}

let service: EmailService | null = null;

export function getEmailService(): EmailService {
  return (service ??= new SendGridEmailService());
}

/**
 * Mail is a side effect of a change that has already been saved, so a mail outage must not fail
 * the request. Returns whether the message was accepted.
 */
export async function sendEmailSafely(message: EmailMessage) {
  try {
    await getEmailService().send(message);
    return true;
  } catch (error) {
    console.error(`[email] could not send "${message.subject}"`, error);
    return false;
  }
}
