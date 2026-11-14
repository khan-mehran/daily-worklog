# VS Code daily sync

Logs your day in WorkLog for you. At the end of the day, a small script reads your git activity in each project and adds **one task per project** to your Tasks page, written up as bullet points. Hours are left blank. The tasks are ordinary tasks, so you can edit or delete them until you submit the week.

Only commit messages and file paths are sent to WorkLog. Your code is never sent.

## Setup (once per developer)

1. In WorkLog, go to **Settings → VS Code sync**, create a token and copy the config it shows.
2. Download `worklog-sync.mjs` from the same section. Put it, and the config as `config.json`, in `~/.worklog/` (on Windows, `C:\Users\<you>\.worklog\`):

   ```json
   {
     "url": "https://teamwork.qa",
     "token": "wlk_...",
     "scan": ["D:/Projects"],
     "repos": []
   }
   ```

   - `scan`: folders searched, up to two levels deep, for repos that contain a `.worklog.json`.
   - `repos`: extra repo paths, or `{ "path": "...", "project": "CODE" }` for repos you can't add a file to.
   - `author` (optional): the email your commits use. It defaults to each repo's `git config user.email`.

3. In each repo, commit a `.worklog.json` that names the WorkLog project by the code on the Projects page:

   ```json
   { "project": "TWK" }
   ```

4. Schedule it: `node ~/.worklog/worklog-sync.mjs --install`. This runs it every day at 18:00 (use `--time 17:30` to change the time). On Windows it creates a Task Scheduler task called "WorkLog daily sync". On macOS and Linux it prints a crontab line for you to add.

## `/worklog` in Claude Code (the best results)

`--install` also adds a `/worklog` command to Claude Code (`~/.claude/commands/worklog.md`). At the end of the day, type `/worklog` in the Claude Code panel, or `/worklog 2026-11-11` for an earlier day. Claude:

1. finds the day's commits and uncommitted work in every linked repo (`worklog-sync.mjs --activity`)
2. reads the actual changes, and also uses what you did together in that conversation
3. writes one list per project, like this:
   - Super Admin and Director roles are created, and the users page is updated for them.
   - GORD employees must log in with their Microsoft account. Only the super admin can accept or reject their access.
4. sends only that list to WorkLog (`worklog-sync.mjs --items -`)

The code is read on your machine and never leaves it. The 6 PM run never replaces a list that `/worklog` has sent. A later `/worklog` run the same day does replace it.

## Running it yourself

```
node ~/.worklog/worklog-sync.mjs              # sync today
node ~/.worklog/worklog-sync.mjs --date 2026-11-11
node ~/.worklog/worklog-sync.mjs --dry-run    # print what would be sent
```

Every run is logged to `~/.worklog/sync.log`.

To get a VS Code command for it, add this to your user `tasks.json` and run **Tasks: Run Task → WorkLog: sync today**:

```json
{
  "label": "WorkLog: sync today",
  "type": "shell",
  "command": "node ${userHome}/.worklog/worklog-sync.mjs",
  "problemMatcher": []
}
```

## How it behaves

- **What counts:** commits by you on any branch that day, and, when syncing today, files with uncommitted changes. Merge commits are ignored.
- **Projects with no activity** are skipped.
- **Several repos with the same project code** are combined into one task.
- **Status:** the task is marked Completed. If the only activity was uncommitted work, it's marked In Progress.
- **Running it twice in a day** refreshes the task instead of adding another one.
- **Edits are kept:** once you edit a synced task, later syncs leave it alone. If you delete it, the next sync that day adds it again.
- **Submitted weeks** are locked, so those days are skipped. The same goes for projects you're not assigned to and project codes that don't exist.
- **Summaries:** the 6 PM run sends commit messages and file names, and the server's AI (`ANTHROPIC_API_KEY`) writes the list in the same style as `/worklog`. If AI isn't configured or fails, the bullets are your commit subjects.
- **Limits:** 20 syncs an hour per person, and 10 projects per sync.

## Server side

- `POST /api/integrations/daily-sync` accepts only `Authorization: Bearer wlk_...` (`tokenRoute` in `src/lib/api/handler.ts`). A token can't call any other API route, and the session cookie can't call this one.
- Tokens are stored as SHA-256 hashes in the `ApiToken` collection. Revoke them in Settings.
- Synced tasks have `source: "sync"` and a `syncHash` of the details the sync last wrote. When the details no longer match that hash, the task has been edited by hand.
- After deploying, run `npm run db:migrate` to create the new indexes.
