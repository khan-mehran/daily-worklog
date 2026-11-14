import type { EmailMessage } from "./types";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title: string, body: string, action: { label: string; url: string }) {
  return `<!doctype html>
<html><body style="margin:0;background:#F6F4EF;font-family:Arial,sans-serif;color:#1A1D23">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E4DFD3;border-radius:12px">
      <tr><td style="padding:32px">
        <p style="margin:0 0 24px;font-weight:700;color:#0F766E">WorkLog</p>
        <h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:22px">${body}</p>
        <a href="${escapeHtml(action.url)}" style="display:inline-block;background:#0F766E;color:#FFFFFF;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export function inviteEmail(input: {
  to: string;
  name: string;
  token: string;
  departmentName?: string;
}): EmailMessage {
  const url = `${appUrl()}/invite/${input.token}`;
  const where = input.departmentName ? ` as manager of ${input.departmentName}` : "";
  const title = "You've been invited to WorkLog";
  return {
    to: input.to,
    subject: title,
    html: layout(
      title,
      `Hi ${escapeHtml(input.name)}, your WorkLog account is ready${escapeHtml(where)}. Set a password to sign in. This link expires in 7 days.`,
      { label: "Set your password", url },
    ),
    text: `Hi ${input.name}, your WorkLog account is ready${where}. Set a password within 7 days: ${url}`,
  };
}

export function departmentAssignedEmail(input: {
  to: string;
  name: string;
  departmentName: string;
}): EmailMessage {
  const url = `${appUrl()}/dashboard`;
  const title = `You now manage ${input.departmentName}`;
  return {
    to: input.to,
    subject: title,
    html: layout(
      title,
      `Hi ${escapeHtml(input.name)}, the CEO has assigned you as manager of ${escapeHtml(input.departmentName)}.`,
      { label: "Open WorkLog", url },
    ),
    text: `Hi ${input.name}, the CEO has assigned you as manager of ${input.departmentName}. ${url}`,
  };
}

/** The email that accompanies an in-app notification. `link` is an app path. */
export function notificationEmail(input: {
  to: string;
  name: string;
  title: string;
  message: string;
  link: string | null;
}): EmailMessage {
  const url = `${appUrl()}${input.link ?? "/notifications"}`;
  return {
    to: input.to,
    subject: input.title,
    html: layout(input.title, `Hi ${escapeHtml(input.name)}, ${escapeHtml(input.message)}`, {
      label: "Open in WorkLog",
      url,
    }),
    text: `Hi ${input.name}, ${input.message}\n\n${url}`,
  };
}
