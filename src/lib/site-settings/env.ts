import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { badRequest } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import type { Actor } from "@/lib/permissions";

// The environment file, edited from the Site settings page. Secret values never leave the server:
// the page is only told whether each one is set.

export interface EnvField {
  key: string;
  label: string;
  hint: string;
  group: "Application" | "Microsoft sign-in" | "Access" | "Email" | "AI" | "Reminders" | "Dependency audit";
  /** Never sent to the browser. Left blank on save, it keeps its value. */
  secret?: boolean;
  /** Can't be emptied. */
  required?: boolean;
  /** Read once when the server starts, so a change needs a restart. */
  restart?: boolean;
  validate?: (value: string) => string | null;
}

const url = (value: string) => {
  try {
    return /^https?:$/.test(new URL(value).protocol) ? null : "Enter a URL that starts with http:// or https://.";
  } catch {
    return "Enter a valid URL.";
  }
};

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export const ENV_FIELDS: readonly EnvField[] = [
  {
    key: "APP_URL",
    label: "App URL",
    hint: "The public address of GET List, used in email links and for Microsoft sign-in.",
    group: "Application",
    required: true,
    validate: url,
  },
  {
    key: "DATABASE_URL",
    label: "Database URL",
    hint: "PostgreSQL connection string. URL-encode special characters in the password (@ becomes %40).",
    group: "Application",
    secret: true,
    required: true,
    restart: true,
    validate: (value) => (/^postgres(ql)?:\/\/.+/.test(value) ? null : "Must start with postgresql://."),
  },
  {
    key: "AUTH_SECRET",
    label: "Session secret",
    hint: "Signs sessions and encrypts the Bitbucket tokens managers save. Changing it signs everyone out, and those tokens must be entered again.",
    group: "Application",
    secret: true,
    required: true,
    restart: true,
    validate: (value) => (value.length >= 16 ? null : "Use at least 16 characters."),
  },
  {
    key: "ENTRA_CLIENT_ID",
    label: "Client ID",
    hint: "The application (client) ID of the Entra app.",
    group: "Microsoft sign-in",
  },
  {
    key: "ENTRA_CLIENT_SECRET",
    label: "Client secret",
    hint: "A client secret value from the Entra app.",
    group: "Microsoft sign-in",
    secret: true,
  },
  {
    key: "ENTRA_TENANT_ID",
    label: "Tenant ID",
    hint: "Your organisation's tenant. Only its accounts may sign in.",
    group: "Microsoft sign-in",
  },
  {
    key: "ENTRA_REDIRECT_URI",
    label: "Redirect URI",
    hint: "Must be registered on the Entra app. Empty uses <App URL>/api/auth/sso/entra/callback.",
    group: "Microsoft sign-in",
    validate: (value) => (value ? url(value) : null),
  },
  {
    key: "SUPER_ADMIN_EMAILS",
    label: "Super Admin emails",
    hint: "Separated by commas. These people are Super Admins from their first sign-in and can't be locked out.",
    group: "Access",
    required: true,
    validate: (value) => {
      const emails = value.split(/[,;\s]+/).filter(Boolean);
      const bad = emails.find((email) => !EMAIL.test(email));
      return bad ? `"${bad}" isn't an email address.` : emails.length ? null : "Enter at least one email address.";
    },
  },
  {
    key: "SENDGRID_API_KEY",
    label: "SendGrid API key",
    hint: "Without a key, emails are logged as failed and the app carries on.",
    group: "Email",
    secret: true,
  },
  {
    key: "SENDGRID_FROM_EMAIL",
    label: "From address",
    hint: 'A sender verified in SendGrid, such as GET List <no-reply@example.com>.',
    group: "Email",
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API key",
    hint: 'Powers "Improve with AI". The app works without it.',
    group: "AI",
    secret: true,
  },
  {
    key: "CRON_SECRET",
    label: "Cron secret",
    hint: "Protects the reminders and dependency audit endpoints. The scheduled job must send the same value.",
    group: "Reminders",
    secret: true,
  },
  {
    key: "BITBUCKET_TOKEN",
    label: "Bitbucket token",
    hint: "Read-only access to your repositories, used once a day to read each project's package-lock.json. An access token needs only the Repositories: Read scope. A department whose manager has connected Bitbucket in Settings uses that account instead.",
    group: "Dependency audit",
    secret: true,
  },
  {
    key: "BITBUCKET_USERNAME",
    label: "Bitbucket username",
    hint: "Leave empty for an access token. For an API token, enter the Atlassian account's email address. For an app password, enter the Bitbucket username.",
    group: "Dependency audit",
  },
];

const FIELD_BY_KEY = new Map(ENV_FIELDS.map((field) => [field.key, field]));

/** The file the app keeps its settings in. */
export const envFilePath = () => resolve(process.cwd(), ".env.local");
/** The previous version, kept on every save. Next.js doesn't load a file with this name. */
const backupPath = (file: string) => resolve(file, "..", ".env.backup.local");

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One `KEY="value"` line that dotenv and Next.js both read back as exactly `value`. */
export function envLine(key: string, value: string) {
  if (/[\r\n]/.test(value)) throw badRequest(`${key} can't contain a line break.`);
  // Next.js expands $NAME inside values and plain dotenv doesn't, so no spelling is safe for both.
  if (value.includes("$")) throw badRequest(`${key} can't contain a $ sign here. Edit the file by hand for that.`);
  const needsSingle = value.includes('"') || value.includes("\\");
  if (needsSingle && value.includes("'")) {
    throw badRequest(`${key} can't mix quotes and backslashes here. Edit the file by hand for that.`);
  }
  return needsSingle ? `${key}='${value}'` : `${key}="${value}"`;
}

/**
 * The file's text with each key in `patch` set. Comments, blank lines and other keys are kept as
 * they are. A key the file doesn't have yet is added at the end.
 */
export function applyEnvPatch(text: string, patch: Record<string, string>) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let lines = text.split(/\r?\n/);
  const missing: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const assignment = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`);
    const first = lines.findIndex((line) => assignment.test(line));
    if (first === -1) {
      missing.push(envLine(key, value));
      continue;
    }
    // A repeated key would win over the line being written, so only the first one stays.
    lines = lines.filter((line, index) => index === first || !assignment.test(line));
    lines[first] = envLine(key, value);
  }
  if (missing.length) {
    while (lines.length && lines.at(-1) === "") lines.pop();
    lines.push(...(lines.length ? [""] : []), ...missing, "");
  }
  return lines.join(eol);
}

async function readEnvFile(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Every setting for the page. A secret comes back as `isSet` only. */
export async function readEnvSettings(file = envFilePath()) {
  const text = await readEnvFile(file);
  const inFile = text === null ? {} : parse(text);
  return {
    file: ".env.local",
    fields: ENV_FIELDS.map((field) => {
      const value = (inFile[field.key] ?? process.env[field.key] ?? "").trim();
      return {
        key: field.key,
        label: field.label,
        hint: field.hint,
        group: field.group,
        secret: Boolean(field.secret),
        required: Boolean(field.required),
        restart: Boolean(field.restart),
        isSet: value !== "",
        value: field.secret ? "" : value,
      };
    }),
  };
}

export type EnvSettings = Awaited<ReturnType<typeof readEnvSettings>>;

/**
 * Writes the changed settings to the file and into this running server. Returns the labels of
 * those that only take effect after a restart.
 */
export async function saveEnvSettings(actor: Actor, patch: Record<string, string>, file = envFilePath()) {
  const changes: Record<string, string> = {};
  for (const [key, raw] of Object.entries(patch)) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) throw badRequest(`${key} isn't a setting that can be changed here.`);
    const value = raw.trim();
    if (!value && field.required) throw badRequest(`${field.label} can't be empty.`);
    const problem = value ? field.validate?.(value) : null;
    if (problem) throw badRequest(`${field.label}: ${problem}`);
    changes[key] = value;
  }
  const keys = Object.keys(changes);
  if (keys.length === 0) return { restart: [] as string[] };

  const current = await readEnvFile(file);
  const next = applyEnvPatch(current ?? "", changes);
  try {
    if (current !== null) await copyFile(file, backupPath(file));
    await writeFile(file, next, "utf8");
  } catch (error) {
    console.error("[site-settings] could not write the environment file", error);
    throw badRequest(
      "The environment file can't be written on this server. Change these settings where the server is hosted.",
      "ENV_NOT_WRITABLE",
    );
  }
  for (const key of keys) process.env[key] = changes[key];

  // Names only: values never go into the log.
  await prisma.auditLog.create({
    data: { actorId: actor.id, action: "site.env", targetType: "SiteSettings", targetId: actor.id, meta: { keys } },
  });
  return { restart: keys.filter((key) => FIELD_BY_KEY.get(key)!.restart).map((key) => FIELD_BY_KEY.get(key)!.label) };
}
