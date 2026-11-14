#!/usr/bin/env node
// WorkLog daily sync: turns today's git activity into tasks on your WorkLog Tasks page.
//
//   node worklog-sync.mjs              sync today
//   node worklog-sync.mjs --date 2026-11-12
//   node worklog-sync.mjs --dry-run    show what would be sent, send nothing
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
// Each repo names its WorkLog project in .worklog.json: { "project": "ABC" }
//
// Only commit messages and file paths are sent, never code. Needs Node 20+ and git.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
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
description: Write today's work list for each project and send it to WorkLog
argument-hint: "[YYYY-MM-DD]"
allowed-tools: Bash(node:*), Bash(git:*)
---
Write my work list for $ARGUMENTS (today if empty) and send it to WorkLog. Don't ask me to confirm; I can edit the tasks in WorkLog afterwards.

1. Run \`${run} --activity\` (add \`--date YYYY-MM-DD\` if a date was given). It prints JSON: for each WorkLog project code, its repo paths, the day's commits (hash and subject) and uncommitted files.
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

function installCommand() {
  mkdirSync(join(homedir(), ".claude", "commands"), { recursive: true });
  writeFileSync(COMMAND_PATH, worklogCommand(fileURLToPath(import.meta.url)));
  log(`Installed the /worklog command for Claude Code (${COMMAND_PATH}).`);
}

function install() {
  installCommand();
  const time = option("--time") ?? "18:00";
  if (!/^\d{2}:\d{2}$/.test(time)) fail("Use --time HH:MM, for example --time 17:30.");
  const script = fileURLToPath(import.meta.url);
  if (platform() === "win32") {
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
  if (!config) fail(`No config at ${CONFIG_PATH}. See the setup steps in WorkLog → Settings → VS Code sync.`);
  if (!config.url || !config.token) fail(`${CONFIG_PATH} needs "url" and "token".`);
  return config;
}

function selectedDay() {
  const day = option("--date") ?? localDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail("Use --date YYYY-MM-DD.");
  return day;
}

/** The day's activity per WorkLog project. Several repos with one project code are merged. */
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

if (flag("--install")) install();
else if (flag("--uninstall")) uninstall();
else if (flag("--activity")) printActivity();
else if (option("--items")) await sendItems(option("--items"));
else await sync();
