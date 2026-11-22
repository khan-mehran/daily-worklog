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
        <p style="margin:0 0 24px;font-weight:700;color:#0F766E">GET List</p>
        <h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:22px">${body}</p>
        <a href="${escapeHtml(action.url)}" style="display:inline-block;background:#0F766E;color:#FFFFFF;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/** For someone added from the Users page, or as a new department's manager, before they sign in. */
export function welcomeEmail(input: { to: string; name: string; departmentName?: string }): EmailMessage {
  const url = `${appUrl()}/login`;
  const where = input.departmentName ? ` as manager of ${input.departmentName}` : "";
  const title = "You've been added to GET List";
  return {
    to: input.to,
    subject: title,
    html: layout(
      title,
      `Hi ${escapeHtml(input.name)}, your GET List account is ready${escapeHtml(where)}. Sign in with your Microsoft account (${escapeHtml(input.to)}).`,
      { label: "Sign in to GET List", url },
    ),
    text: `Hi ${input.name}, your GET List account is ready${where}. Sign in with your Microsoft account (${input.to}): ${url}`,
  };
}

/** For someone who signed in, waited, and has now been approved. */
export function accessApprovedEmail(input: {
  to: string;
  name: string;
  role: string;
  departmentName?: string;
}): EmailMessage {
  const url = `${appUrl()}/login`;
  const place = input.departmentName ? `${input.role} in ${input.departmentName}` : input.role;
  const title = "Your GET List access is approved";
  return {
    to: input.to,
    subject: title,
    html: layout(
      title,
      `Hi ${escapeHtml(input.name)}, your access to GET List has been approved. You're set up as ${escapeHtml(place)}. Sign in with your Microsoft account to get started.`,
      { label: "Sign in to GET List", url },
    ),
    text: `Hi ${input.name}, your access to GET List has been approved. You're set up as ${place}. Sign in with your Microsoft account: ${url}`,
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
      `Hi ${escapeHtml(input.name)}, you've been assigned as manager of ${escapeHtml(input.departmentName)}.`,
      { label: "Open GET List", url },
    ),
    text: `Hi ${input.name}, you've been assigned as manager of ${input.departmentName}. ${url}`,
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
      label: "Open in GET List",
      url,
    }),
    text: `Hi ${input.name}, ${input.message}\n\n${url}`,
  };
}
