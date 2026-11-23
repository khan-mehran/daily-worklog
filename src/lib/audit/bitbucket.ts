// Reads single files from Bitbucket Cloud. The audit needs a project's lockfile and nothing else,
// so no repository is ever cloned and no code is stored.

import { AuditError } from "./errors";

const API = "https://api.bitbucket.org/2.0/repositories";
const TIMEOUT_MS = 30_000;

export const bitbucketConfigured = () => Boolean(process.env.BITBUCKET_TOKEN?.trim());

/**
 * An access token (repository, project or workspace) is sent as a Bearer token. With
 * BITBUCKET_USERNAME set, the token is an API token or app password and goes with the username.
 */
function authorization() {
  const token = process.env.BITBUCKET_TOKEN?.trim();
  if (!token) return null;
  const username = process.env.BITBUCKET_USERNAME?.trim();
  return username ? `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}` : `Bearer ${token}`;
}

async function get(path: string) {
  const header = authorization();
  let response: Response;
  try {
    response = await fetch(`${API}/${path}`, {
      headers: header ? { Authorization: header } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AuditError("Bitbucket couldn't be reached.");
  }
  if (response.status === 401) throw new AuditError("Bitbucket rejected the token. Check it in Site settings.");
  if (response.status === 403) throw new AuditError("The Bitbucket token can't read this repository.");
  if (response.status === 429) throw new AuditError("Bitbucket is limiting requests. It will be tried again.");
  if (!response.ok && response.status !== 404) throw new AuditError(`Bitbucket answered ${response.status}.`);
  return response;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/**
 * The project's lockfile from the head of the main branch, or null when the repository has none.
 * `repository` is "workspace/repo" or "workspace/repo/folder", as stored on the project.
 */
export async function fetchLockfile(repository: string): Promise<string | null> {
  const [workspace, slug, ...folder] = repository.split("/");
  const repo = `${encodeURIComponent(workspace!)}/${encodeURIComponent(slug!)}`;
  for (const file of ["package-lock.json", "npm-shrinkwrap.json"]) {
    const response = await get(`${repo}/src/HEAD/${encodePath([...folder, file].join("/"))}`);
    if (response.ok) return response.text();
  }
  // A missing file and a repository the token can't see are both a 404, so ask which it was.
  const found = await get(repo);
  if (!found.ok) {
    throw new AuditError(`The repository ${workspace}/${slug} wasn't found, or the token can't read it.`);
  }
  return null;
}
