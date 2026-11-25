// Talks to Bitbucket Cloud. The audit needs a project's lockfile and the import needs the list of
// repositories, so no repository is ever cloned and no code is stored.

import { AuditError } from "./errors";

const API = "https://api.bitbucket.org/2.0";
const TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;
/** Stops a listing that never ends. 50 pages is 5,000 repositories. */
const MAX_PAGES = 50;

export interface BitbucketCredentials {
  token: string;
  /** Null for an access token. The Atlassian email for an API token, or the username for an app password. */
  username: string | null;
}

/** The organisation-wide token from Site settings, used by departments that haven't connected their own. */
export function siteCredentials(): BitbucketCredentials | null {
  const token = process.env.BITBUCKET_TOKEN?.trim();
  return token ? { token, username: process.env.BITBUCKET_USERNAME?.trim() || null } : null;
}

/**
 * An access token (repository, project or workspace) is sent as a Bearer token. With a username,
 * the token is an API token or app password and goes with the username.
 */
const authorization = ({ token, username }: BitbucketCredentials) =>
  username ? `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}` : `Bearer ${token}`;

/** A response that is either OK or a 404. Anything else is an AuditError that says what went wrong. */
async function get(url: string, credentials: BitbucketCredentials, forbidden: string) {
  // A "next" link comes from Bitbucket's own answer. The token only ever goes to Bitbucket.
  if (!url.startsWith(`${API}/`)) throw new AuditError("Bitbucket answered with an address that isn't its own.");
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: authorization(credentials) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AuditError("Bitbucket couldn't be reached.");
  }
  if (response.status === 401) throw new AuditError("Bitbucket rejected the token. Check the token and the username.");
  if (response.status === 403) throw new AuditError(forbidden);
  if (response.status === 429) throw new AuditError("Bitbucket is limiting requests. Try again later.");
  if (!response.ok && response.status !== 404) throw new AuditError(`Bitbucket answered ${response.status}.`);
  return response;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/**
 * The project's lockfile from the head of the main branch, or null when the repository has none.
 * `repository` is "workspace/repo" or "workspace/repo/folder", as stored on the project.
 */
export async function fetchLockfile(repository: string, credentials: BitbucketCredentials): Promise<string | null> {
  const cantRead = "The Bitbucket token can't read this repository.";
  const [workspace, slug, ...folder] = repository.split("/");
  const repo = `${API}/repositories/${encodeURIComponent(workspace!)}/${encodeURIComponent(slug!)}`;
  for (const file of ["package-lock.json", "npm-shrinkwrap.json"]) {
    const response = await get(`${repo}/src/HEAD/${encodePath([...folder, file].join("/"))}`, credentials, cantRead);
    if (response.ok) return response.text();
  }
  // A missing file and a repository the token can't see are both a 404, so ask which it was.
  const found = await get(repo, credentials, cantRead);
  if (!found.ok) {
    throw new AuditError(`The repository ${workspace}/${slug} wasn't found, or the token can't read it.`);
  }
  return null;
}

type Json = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Every item of a paged listing, or null when the listing itself is a 404. */
async function pages(first: string, credentials: BitbucketCredentials, forbidden: string, limit = Infinity) {
  const items: Json[] = [];
  let url: string | null = first;
  for (let page = 0; url && page < MAX_PAGES && items.length < limit; page += 1) {
    const response = await get(url, credentials, forbidden);
    if (!response.ok) return page === 0 ? null : items;
    const body = (await response.json().catch(() => null)) as { values?: unknown; next?: unknown } | null;
    if (Array.isArray(body?.values)) items.push(...(body.values as Json[]));
    url = typeof body?.next === "string" ? body.next : null;
  }
  return items;
}

const CANT_LIST_WORKSPACES =
  "The token works, but it isn't allowed to list your workspaces. Enter your workspaces in the Workspaces field, separated by commas, or create a token that also has the workspace read scope (read:workspace:bitbucket).";
const cantListRepositories = (workspace: string) =>
  `The token isn't allowed to list the repositories of the workspace ${workspace}. It needs the repository read scope (read:repository:bitbucket).`;

/** The slugs of the workspaces the account belongs to. */
async function workspacesOf(credentials: BitbucketCredentials) {
  // The current listing first, then the one it replaced, which older tokens still answer.
  for (const path of ["user/workspaces", "workspaces?role=member"]) {
    const separator = path.includes("?") ? "&" : "?";
    const items = await pages(`${API}/${path}${separator}pagelen=${PAGE_SIZE}`, credentials, CANT_LIST_WORKSPACES);
    if (items === null) continue;
    const slugs = items.map((item) => text((item.workspace as Json | undefined)?.slug) || text(item.slug));
    return [...new Set(slugs.filter(Boolean))];
  }
  throw new AuditError(
    "Bitbucket didn't say which workspaces this token belongs to. Enter your workspaces beside the token.",
  );
}

export interface BitbucketRepository {
  /** "workspace/repo", as stored on a project. */
  fullName: string;
  name: string;
  slug: string;
  description: string;
}

/** "a, b" as saved on a connection becomes ["a", "b"]. Nothing saved means none named. */
export const workspaceList = (saved: string | null | undefined) =>
  (saved ?? "").split(/[\s,]+/).filter(Boolean);

/**
 * The repositories the token can read: those of the named workspaces, or with none named, of
 * every workspace the account belongs to. `limit` stops early, to test a token cheaply.
 */
export async function listRepositories(
  credentials: BitbucketCredentials,
  named: string[],
  limit = Infinity,
): Promise<BitbucketRepository[]> {
  const workspaces = named.length > 0 ? named : await workspacesOf(credentials);
  const repositories = new Map<string, BitbucketRepository>();
  for (const slug of workspaces) {
    if (repositories.size >= limit) break;
    const items = await pages(
      `${API}/repositories/${encodeURIComponent(slug)}?pagelen=${PAGE_SIZE}`,
      credentials,
      cantListRepositories(slug),
      limit - repositories.size,
    );
    if (items === null) {
      if (named.length > 0) throw new AuditError(`The workspace ${slug} wasn't found, or the token can't read it.`);
      continue;
    }
    for (const item of items) {
      const fullName = text(item.full_name);
      if (!fullName || repositories.has(fullName.toLowerCase())) continue;
      const repoSlug = text(item.slug) || fullName.split("/")[1] || "";
      repositories.set(fullName.toLowerCase(), {
        fullName,
        name: text(item.name) || repoSlug,
        slug: repoSlug,
        description: text(item.description),
      });
    }
  }
  return [...repositories.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}
