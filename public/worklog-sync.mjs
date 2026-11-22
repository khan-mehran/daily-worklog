#!/usr/bin/env node
// WorkLog daily sync: turns today's git activity into tasks on your GET List Tasks page.
//
//   node worklog-sync.mjs              sync today
//   node worklog-sync.mjs --date 2026-11-12
//   node worklog-sync.mjs --dry-run    show what would be sent, send nothing
//   node worklog-sync.mjs --setup --url https://teamwork.qa
//                                      do everything, from inside a repo: copy this script to
//                                      ~/.worklog, create a token (you approve it in the browser),
//                                      write config.json, link the repo to its GET List project in
//                                      .worklog.json (--project CODE to choose it yourself), and --install
//   node worklog-sync.mjs --install    run it every day at 18:00 (--time 17:30 to change), and add
//                                      the /worklog command to Claude Code
//   node worklog-sync.mjs --uninstall  stop the daily run
//
// Used by the /worklog command:
//   node worklog-sync.mjs --activity        print today's repos and commits as JSON, send nothing
//   node worklog-sync.mjs --items list.json send a finished work list ("-" reads stdin)
//
// Config: ~/.worklog/config.json
//   {
//     "url": "https://teamwork.qa",
//     "token": "wlk_...",                    // Settings → VS Code sync → Create token
//     "scan": ["D:/Projects"],               // folders searched (2 levels) for repos with .worklog.json
//     "repos": ["D:/Other/repo", { "path": "D:/x", "project": "ABC" }],
//     "author": "you@company.com"            // optional; defaults to each repo's git user.email
//   }
// Each repo names its GET List project in .worklog.json: { "project": "ABC", "name": "Project name" }
// (--setup writes it; only "project" is read)
//
// Only commit messages and file paths are sent, never code. Needs Node 20+ and git.

import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, hostname, platform } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const HOME_DIR = join(homedir(), ".worklog");
const CONFIG_PATH = join(HOME_DIR, "config.json");
const LOG_PATH = join(HOME_DIR, "sync.log");
const TASK_NAME = "WorkLog daily sync";
const COMMAND_PATH = join(homedir(), ".claude", "commands", "worklog.md");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor"]);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

function log(message) {
  console.log(message);
  try {
    mkdirSync(HOME_DIR, { recursive: true });
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Logging is best effort.
  }
}

function fail(message) {
  log(`ERROR: ${message}`);
  process.exit(1);
}

const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function nextDay(day) {
  const [year, month, date] = day.split("-").map(Number);
  return localDay(new Date(year, month - 1, date + 1));
}

const git = (cwd, gitArgs) =>
  execFileSync("git", gitArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 });

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

/**
 * The /worklog command for Claude Code. Claude reads the day's real changes on this machine, writes
 * the work list, and sends only the list. Keep the style in step with WORK_LIST_STYLE in
 * src/lib/ai/index.ts.
 */
function worklogCommand(script) {
  const run = `node "${script.replaceAll("\\", "/")}"`;
  return `---
description: Write today's work list for each project and send it to GET List
argument-hint: "[YYYY-MM-DD]"
allowed-tools: Bash(node:*), Bash(git:*)
---
Write my work list for $ARGUMENTS (today if empty) and send it to GET List. Don't ask me to confirm; I can edit the tasks in GET List afterwards.

1. Run \`${run} --activity\` (add \`--date YYYY-MM-DD\` if a date was given). It prints JSON: for each GET List project code, its repo paths, the day's commits (hash and subject) and uncommitted files.
2. For each project, find out what was actually done. Use \`git -C <path> show --stat <hash>\`, then read the diffs that matter with \`git -C <path> show <hash>\` and, for uncommitted work, \`git -C <path> diff HEAD\`. Also use what we did together in this conversation.
3. Write the list for each project.

Write each item as one plain sentence about a feature or outcome, the way a developer tells their manager what got done. For example:
- Super Admin and Director roles are created, and the users page is updated for them.
- GORD employees must log in with their Microsoft account. Only the super admin can accept or reject their access.
- When a new GORD user logs in with Microsoft, the super admin gets a notification and can approve or reject them.
- Filters are added on the users page, and the users page now has tabs for each module.
- The organizations and users flow is updated.

Rules:
- Describe what changed for users and the product, not the code. No file names, function names, commit hashes or library names.
- Combine related changes into one item. Usually 2 to 8 items per project.
- Keep names of roles, pages, modules and ticket references exactly as they appear.
- If work is unfinished, say so in the item, and set that project's status to "In Progress".
- Don't invent anything the changes don't show.

4. Send it by piping JSON to \`${run} --items -\`:
   \`{"date": "YYYY-MM-DD", "projects": [{"code": "TWK", "items": ["...", "..."], "status": "Completed"}]}\`
5. Show me the list for each project and the result line the script printed.
`;
}

function installCommand(script) {
  mkdirSync(join(homedir(), ".claude", "commands"), { recursive: true });
  writeFileSync(COMMAND_PATH, worklogCommand(script));
  log(`Installed the /worklog command for Claude Code (${COMMAND_PATH}).`);
}

function isScheduled() {
  try {
    execFileSync("schtasks", ["/Query", "/TN", TASK_NAME], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** `keepSchedule` leaves an existing daily run alone, so running --setup again doesn't reset its time. */
function install(script = fileURLToPath(import.meta.url), keepSchedule = false) {
  installCommand(script);
  const time = option("--time") ?? "18:00";
  if (!/^\d{2}:\d{2}$/.test(time)) fail("Use --time HH:MM, for example --time 17:30.");
  if (platform() === "win32") {
    if (keepSchedule && !option("--time") && isScheduled()) return log(`"${TASK_NAME}" is already scheduled.`);
    execFileSync(
      "schtasks",
      ["/Create", "/F", "/SC", "DAILY", "/ST", time, "/TN", TASK_NAME, "/TR", `"${process.execPath}" "${script}"`],
      { stdio: "inherit" },
    );
    log(`Installed: "${TASK_NAME}" runs every day at ${time}. Remove it with --uninstall.`);
  } else {
    const [hour, minute] = time.split(":").map(Number);
    console.log("Add this line with `crontab -e`:");
    console.log(`${minute} ${hour} * * * "${process.execPath}" "${script}"`);
  }
}

function uninstall() {
  if (platform() !== "win32") return console.log("Remove the worklog-sync line with `crontab -e`.");
  execFileSync("schtasks", ["/Delete", "/F", "/TN", TASK_NAME], { stdio: "inherit" });
  log(`Removed "${TASK_NAME}".`);
}

/** Repos with a .worklog.json, up to two levels under each scan folder. */
function scanFolder(root, depth = 2) {
  const found = [];
  if (existsSync(join(root, ".worklog.json"))) return [root];
  if (depth === 0) return found;
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
      found.push(...scanFolder(join(root, entry.name), depth - 1));
    }
  }
  return found;
}

/** [{ path, project }] from config.repos and config.scan. */
function discoverRepos(config) {
  const repos = new Map();
  const add = (path, project) => {
    const full = resolve(path);
    if (!statSync(full, { throwIfNoEntry: false })?.isDirectory()) return log(`Skipping ${full}: folder not found.`);
    const code = project ?? readJson(join(full, ".worklog.json"))?.project;
    if (!code) return log(`Skipping ${full}: no "project" in .worklog.json.`);
    repos.set(full.toLowerCase(), { path: full, project: String(code).toUpperCase() });
  };
  for (const repo of config.repos ?? []) {
    if (typeof repo === "string") add(repo);
    else if (repo?.path) add(repo.path, repo.project);
  }
  for (const root of config.scan ?? []) for (const path of scanFolder(resolve(root))) add(path);
  return [...repos.values()];
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The day's commits, changed files and (for today) uncommitted files in one repo. */
function repoActivity(repo, day, author) {
  const email = author ?? git(repo.path, ["config", "user.email"]).trim();
  if (!email) throw new Error("no git user.email; set \"author\" in config.json");
  const range = ["--all", "--no-merges", `--since=${day} 00:00`, `--until=${nextDay(day)} 00:00`, `--author=${escapeRegex(email)}`];

  const commits = new Map();
  for (const record of git(repo.path, ["log", ...range, "--format=%H%x1f%s%x1f%b%x1e"]).split("\x1e")) {
    const [hash, subject, body] = record.trim().split("\x1f");
    if (hash && subject && !commits.has(hash)) {
      commits.set(hash, { hash, subject: subject.trim(), body: (body ?? "").trim().slice(0, 2000) });
    }
  }
  const changedFiles = [
    ...new Set(git(repo.path, ["log", ...range, "--name-only", "--format="]).split("\n").map((line) => line.trim()).filter(Boolean)),
  ];
  const uncommittedFiles =
    day === localDay()
      ? git(repo.path, ["status", "--porcelain=v1", "-uall"])
          .split("\n")
          .map((line) => line.slice(3).split(" -> ").pop()?.trim().replace(/^"|"$/g, ""))
          .filter(Boolean)
      : [];
  return { commits: [...commits.values()], changedFiles, uncommittedFiles };
}

function loadConfig() {
  const config = readJson(CONFIG_PATH);
  if (!config) fail(`No config at ${CONFIG_PATH}. See the setup steps in GET List → Settings → VS Code sync.`);
  if (!config.url || !config.token) fail(`${CONFIG_PATH} needs "url" and "token".`);
  return config;
}

function selectedDay() {
  const day = option("--date") ?? localDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail("Use --date YYYY-MM-DD.");
  return day;
}

/** The day's activity per GET List project. Several repos with one project code are merged. */
function collectActivity(config, day) {
  const byProject = new Map();
  for (const repo of discoverRepos(config)) {
    let activity;
    try {
      activity = repoActivity(repo, day, config.author);
    } catch (error) {
      log(`Skipping ${repo.path}: ${error.message}`);
      continue;
    }
    if (activity.commits.length === 0 && activity.uncommittedFiles.length === 0) continue;
    const merged = byProject.get(repo.project) ?? { code: repo.project, repos: [] };
    merged.repos.push({ path: repo.path, ...activity });
    byProject.set(repo.project, merged);
  }
  return [...byProject.values()];
}

async function send(config, body) {
  if (body.projects.length > 10) log(`Only the first 10 of ${body.projects.length} projects are synced.`);
  const response = await fetch(new URL("/api/integrations/daily-sync", config.url), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ ...body, projects: body.projects.slice(0, 10) }),
  }).catch((error) => fail(`Couldn't reach ${config.url}: ${error.message}`));
  const payload = await response.json().catch(() => null);
  if (!response.ok) fail(`${response.status} ${payload?.error?.message ?? response.statusText}`);

  log(`${body.date}: synced to ${config.url}`);
  for (const result of payload.data.results) {
    log(`  ${result.code}${result.project ? ` (${result.project})` : ""}: ${result.outcome}. ${result.message}`);
  }
}

/** The automatic run: sends commits and file names, and the server writes the list. */
async function sync() {
  const config = loadConfig();
  const day = selectedDay();
  const projects = collectActivity(config, day).map((project) => {
    const all = (key) => project.repos.flatMap((repo) => repo[key]);
    return {
      code: project.code,
      commits: all("commits").map(({ subject, body }) => ({ subject, body })).slice(0, 100),
      changedFiles: [...new Set(all("changedFiles"))].slice(0, 200),
      uncommittedFiles: [...new Set(all("uncommittedFiles"))].slice(0, 200),
    };
  });
  if (projects.length === 0) return log(`${day}: no git activity found. Nothing to sync.`);
  if (flag("--dry-run")) return console.log(JSON.stringify({ date: day, projects }, null, 2));
  await send(config, { date: day, projects });
}

/** For the /worklog command: where to look. Prints repos and commit hashes, sends nothing. */
function printActivity() {
  const config = loadConfig();
  const day = selectedDay();
  const projects = collectActivity(config, day).map((project) => ({
    code: project.code,
    repos: project.repos.map((repo) => ({
      path: repo.path,
      commits: repo.commits.map(({ hash, subject }) => ({ hash, subject })),
      uncommittedFiles: repo.uncommittedFiles,
    })),
  }));
  console.log(JSON.stringify({ date: day, projects }, null, 2));
}

/** Sends a finished work list: JSON { date?, projects: [{ code, items: [...], status? }] } from a file or "-" for stdin. */
async function sendItems(source) {
  const config = loadConfig();
  let input;
  try {
    input = JSON.parse(readFileSync(source === "-" ? 0 : source, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`Couldn't read the work list from ${source}: ${error.message}`);
  }
  const projects = (input?.projects ?? [])
    .map((project) => ({
      code: String(project.code ?? "").toUpperCase(),
      items: (project.items ?? []).map((item) => String(item).trim()).filter(Boolean),
      ...(project.status ? { status: project.status } : {}),
    }))
    .filter((project) => project.code && project.items.length > 0);
  if (projects.length === 0) fail("The work list has no projects with items.");
  await send(config, { date: input.date ?? selectedDay(), projects });
}

// --- Setup: one command that connects this computer and links the current repo. ---

const SETUP_SCRIPT = join(HOME_DIR, "worklog-sync.mjs");
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

function openBrowser(url) {
  const [command, commandArgs] =
    platform() === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : platform() === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  // If no browser opens, the printed link still works.
  execFile(command, commandArgs, () => {});
}

const closingPage = (title, message) =>
  `<!doctype html><meta charset="utf-8"><title>GET List</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1 style="font-size:1.25rem">${title}</h1><p>${message}</p></body>`;

/**
 * Gets a token without copy and paste. GET List's /connect page, where you are signed in, creates
 * the token when you press Connect and posts it to this one-off listener on 127.0.0.1. `state`
 * proves the post answers this run.
 */
function connect(url) {
  const state = randomBytes(24).toString("base64url");
  return new Promise((resolveToken) => {
    const server = createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/callback") return res.writeHead(404).end();
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 4096) req.destroy();
      });
      req.on("end", () => {
        const form = new URLSearchParams(body);
        const token = form.get("token") ?? "";
        const ok = form.get("state") === state && /^wlk_[\w-]{20,}$/.test(token);
        res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8", Connection: "close" });
        res.end(
          ok
            ? closingPage("This computer is connected to GET List", "You can close this tab and go back to the terminal.")
            : closingPage("That didn't work", "Run the setup command again."),
        );
        if (!ok) return;
        clearTimeout(timer);
        server.close();
        resolveToken(token);
      });
    });
    const timer = setTimeout(() => fail("Nobody pressed Connect within 5 minutes. Run the setup command again."), CONNECT_TIMEOUT_MS);
    server.listen(0, "127.0.0.1", () => {
      const link = new URL("/connect", url);
      link.searchParams.set("port", String(server.address().port));
      link.searchParams.set("state", state);
      link.searchParams.set("name", hostname().slice(0, 60));
      console.log(`Opening GET List in your browser. Sign in if asked, then press Connect.\nIf nothing opens, go to:\n  ${link}`);
      openBrowser(link.href);
    });
  });
}

/** The projects this token's owner can log work on: [{ code, name }]. Null when the token isn't accepted. */
async function fetchProjects(url, token) {
  const response = await fetch(new URL("/api/integrations/projects", url), {
    headers: { Authorization: `Bearer ${token}` },
  }).catch((error) => fail(`Couldn't reach ${url}: ${error.message}`));
  if (response.status === 401) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) fail(`${response.status} ${payload?.error?.message ?? response.statusText}`);
  return payload.data;
}

const simplify = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");

/** The one project whose code or name matches the repo's folder or remote name, or null. */
function detectProject(repo, projects) {
  const names = [basename(repo)];
  try {
    names.push(basename(git(repo, ["config", "--get", "remote.origin.url"]).trim()).replace(/\.git$/, ""));
  } catch {
    // No remote.
  }
  const candidates = names.map(simplify).filter(Boolean);
  const exact = projects.filter((project) =>
    candidates.some((name) => name === simplify(project.code) || name === simplify(project.name)),
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const partial = projects.filter((project) => {
    const projectName = simplify(project.name);
    return (
      projectName.length >= 3 &&
      candidates.some((name) => name.length >= 3 && (name.includes(projectName) || projectName.includes(name)))
    );
  });
  return partial.length === 1 ? partial[0] : null;
}

async function askForProject(repo, projects) {
  const list = projects.map((project, index) => `  ${index + 1}. ${project.code}  ${project.name}`).join("\n");
  if (!process.stdin.isTTY) {
    log(`Couldn't tell which project ${repo} belongs to. Run --setup again with --project CODE:\n${list}`);
    return null;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (
        await prompt.question(`Which GET List project is ${basename(repo)}?\n${list}\nNumber or code (Enter to skip): `)
      ).trim();
      if (!answer) return null;
      const chosen = projects[Number(answer) - 1] ?? projects.find((project) => project.code === answer.toUpperCase());
      if (chosen) return chosen;
    }
  } finally {
    prompt.close();
  }
}

/** Writes the repo's .worklog.json and makes sure the daily run will find the repo. */
async function linkRepo(repo, projects, config) {
  const linkPath = join(repo, ".worklog.json");
  const byCode = (code) => projects.find((project) => project.code === String(code ?? "").toUpperCase());
  const requested = option("--project");
  if (requested && !byCode(requested)) {
    const codes = projects.map((project) => project.code).join(", ");
    fail(`No project with code ${requested} that you can log work on. Yours: ${codes}.`);
  }
  const current = byCode(readJson(linkPath)?.project);
  const project =
    byCode(requested) ??
    current ??
    detectProject(repo, projects) ??
    // Someone on a single project has nothing to choose between.
    (projects.length === 1 ? projects[0] : await askForProject(repo, projects));
  if (!project) return log(`${repo} isn't linked to a project yet.`);
  // Only "project" is read. "name" is there so people can see which project the code means.
  const link = `{ "project": ${JSON.stringify(project.code)}, "name": ${JSON.stringify(project.name)} }\n`;
  if (!existsSync(linkPath) || readFileSync(linkPath, "utf8") !== link) writeFileSync(linkPath, link);
  log(`${repo} is linked to ${project.code} (${project.name}).`);

  const found = discoverRepos(config).some((entry) => entry.path.toLowerCase() === repo.toLowerCase());
  if (!found) config.repos = [...(config.repos ?? []), repo.replaceAll("\\", "/")];
}

async function setup() {
  mkdirSync(HOME_DIR, { recursive: true });
  const self = fileURLToPath(import.meta.url);
  if (resolve(self).toLowerCase() !== SETUP_SCRIPT.toLowerCase()) copyFileSync(self, SETUP_SCRIPT);

  const config = readJson(CONFIG_PATH) ?? {};
  const url = String(option("--url") ?? config.url ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\/\S+$/.test(url)) fail("Say where GET List is: --setup --url https://your-getl-address");
  // A token belongs to the server that made it.
  let token = config.url === url ? config.token : undefined;
  let projects = token ? await fetchProjects(url, token) : null;
  if (projects) {
    log(`Already connected to ${url}.`);
  } else {
    token = await connect(url);
    projects = await fetchProjects(url, token);
    if (!projects) fail("GET List didn't accept the new token. Run the setup command again.");
    log(`Connected to ${url}.`);
  }
  Object.assign(config, { url, token, scan: config.scan ?? [], repos: config.repos ?? [] });
  const save = () => writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  save();

  let repo = null;
  try {
    repo = resolve(git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim());
  } catch {
    log("This folder isn't a git repo, so no project was linked. Run --setup again inside each repo.");
  }
  if (repo && projects.length === 0) {
    log("You aren't assigned to an active project yet, so no project was linked.");
  } else if (repo) {
    await linkRepo(repo, projects, config);
    save();
  }

  install(SETUP_SCRIPT, true);
  log("Setup finished. Type /worklog in Claude Code at the end of the day. Run --setup again inside any other repo to link it.");
}

if (flag("--setup")) await setup();
else if (flag("--install")) install();
else if (flag("--uninstall")) uninstall();
else if (flag("--activity")) printActivity();
else if (option("--items")) await sendItems(option("--items"));
else await sync();
