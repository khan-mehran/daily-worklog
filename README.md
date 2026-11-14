# WorkLog

Role-based work reporting and approvals. It replaces the manual Excel process (Developer → Team Lead → Manager → CEO) across departments, with strict data isolation between them.

**Status:** all 8 phases are built. See [What's in it](#whats-in-it).

## Setup

You need Node 20.9 or newer and MongoDB.

```bash
npm install
cp .env.example .env.local      # then set AUTH_SECRET: npx auth secret
docker compose up -d            # MongoDB, Mongo Express, Mailpit (skip if MongoDB is installed)
npm run seed                    # erases the "worklog" database, then loads demo data
npm run dev
```

The app is at <http://localhost:3000>. If that port is taken, Next.js picks the next free one and prints it. In that case, set `APP_URL` in `.env.local` to the same address, so email links point at WorkLog.

**Already have MongoDB installed?** Skip `docker compose up -d`. The app uses a database called `worklog`, and `npm run seed` erases only that database.

**No Docker and no MongoDB?** Run `npm run db:dev` in a second terminal. It runs a real MongoDB with data in `.data/mongo`, and downloads about 780 MB the first time. It exits straight away if MongoDB is already running on port 27017.

**Upgrading an existing database?** Run `npm run db:migrate` instead of reseeding. It adds what newer versions need and keeps your data.

| Service       | URL                     | Notes                                                    |
| ------------- | ----------------------- | -------------------------------------------------------- |
| Mailpit       | <http://localhost:8025> | Catches all local mail. Without it, emails are logged as failed and the app carries on |
| Mongo Express | <http://localhost:8081> | `admin` / `worklog`                                      |

### Optional settings

- `ANTHROPIC_API_KEY`: turns on "Improve with AI". Without it, the button explains it isn't set up, and saving still works.
- `CRON_SECRET`: protects the reminders endpoint. See [Reminders](#reminders).

## Demo logins

The password for every account is `WorkLog!2026`.

| Role      | Email                                                | Sees                             |
| --------- | ---------------------------------------------------- | -------------------------------- |
| CEO       | `ceo@worklog.demo`                                   | All departments, with a switcher |
| Manager   | `manager.it@worklog.demo`, `manager.hr@worklog.demo` | Their own department only        |
| Team Lead | `lead1.it@worklog.demo`, `lead1.hr@worklog.demo`     | Their own department only        |
| Developer | `dev1.it@worklog.demo`, `dev1.hr@worklog.demo`       | Their own department only        |

Other departments follow the same pattern with the codes `adv`, `acc` and `mkt`. Each department's `dev1` starts with an open week, ready to submit.

**To see the whole workflow:** sign in as `dev1.it`, add a task on the Tasks page (or press **N**), then use **Submit week** on the Weekly tab. Sign in as `lead1.it` and approve it from **Reviews**, then as `manager.it`. The CEO only sees it after the Manager's approval.

## What's in it

| Area | Highlights |
| ---- | ---------- |
| Tasks | Daily, Weekly and Monthly tabs. Add Task with templates, copy the previous day, and **N** to add |
| Workflow | Submit, approve ("Done") and request changes with a comment. Tasks lock once submitted. Full review history |
| Reviews | Inbox of weeks waiting for you, oldest first, with bulk approve. Blocked tasks highlighted |
| Dashboards | One per role, following the top bar's date range. The CEO's uses fully approved work only |
| Projects | Create, assign people, status, colour and dates. Developers see only their own projects |
| Departments | Add with a manager (existing, or invited by email), edit, change manager, archive |
| Notifications | Bell with live updates (Server-Sent Events, with 30-second polling as a fallback), full history, emails |
| Export | Excel with Tasks and Summary sheets, filtered by people, project, dates and report status. Owners can download one week |
| AI | "Improve with AI" in the task form, with a side-by-side diff and Accept, Edit or Discard |
| Search | **Ctrl+K** or **Cmd+K**: pages, projects, people and your own tasks |
| Other | Team page, settings (profile, password, theme, notification preferences), reminders, light and dark themes |

## Commands

| Command              | What it does                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `npm run dev`        | Start the development server                                              |
| `npm run seed`       | **Erase the `worklog` database** and load demo data. Refuses to run in production |
| `npm run db:migrate` | Bring an existing database up to date, keeping its data                   |
| `npm run db:dev`     | Run MongoDB without Docker                                                |
| `npm run cron`       | Run the reminders every hour, for self-hosting                            |
| `npm test`           | Unit and API tests, against an in-memory MongoDB                          |
| `npm run test:e2e`   | Browser tests: builds the app into `.next-e2e`, serves it on port 3100 and uses its own `worklog_e2e` database. Needs MongoDB running and about 3 GB of free memory |
| `npm run typecheck`  | TypeScript check                                                          |
| `npm run lint`       | ESLint                                                                    |
| `npm run format`     | Prettier                                                                  |

## Reminders

`GET /api/cron/reminders` with the header `Authorization: Bearer <CRON_SECRET>`:

- From Friday 4 PM, it reminds everyone who hasn't submitted the week.
- Every run, it reminds approvers about weeks waiting more than two days.

It never sends the same reminder twice, so it's safe to run often.

- **On Vercel:** `vercel.json` already schedules it: Friday 13:00 UTC (4 PM in Qatar) and daily at 06:00 UTC. Set `CRON_SECRET` in the project.
- **Self-hosted:** run `npm run cron` beside the app, or call the URL from any scheduler:

  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reminders
  ```

## Project layout

```
src/app          Pages and API route handlers
src/components   UI: ui/ primitives, layout/ app shell, one folder per feature
src/lib          auth, permissions, api, db, email, ai, reports (workflow, visibility), tasks,
                 projects, departments, users, dashboards, export, notifications, reminders, search
src/models       Mongoose schemas
src/validators   Zod schemas shared by client and server
src/hooks        Shared React hooks
scripts          seed, migrate, dev-db, cron
tests            Vitest unit and API tests
e2e              Playwright browser tests
docs             Architecture: isolation, the workflow state machine and visibility rules
```

How isolation, authorisation and the workflow work: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Assumptions

Decisions made where the brief left room. Each is easy to change.

**Org structure**

- There is exactly one CEO, created by the seed. The CEO's role can't be changed and no second CEO can be created.
- A Developer must report to a Team Lead, so a department needs a Team Lead before it can have Developers.
- A Manager can exist without a department while waiting for one. They see no data until assigned.
- Changing a department's manager moves its Team Leads and open reviews to the new manager. The previous manager becomes unassigned.
- Someone with direct reports can't be moved, have their role changed or be deactivated until those reports are moved.
- Moving a user to another department removes them from their old projects. Past reports stay in the old department.

**Departments**

- Archiving keeps all data and hides the department from the switcher. Nobody can be added to it until it's restored, and its members can still sign in.
- Only a department with no data can be deleted.

**Tasks and the workflow**

- Changes requested is its own status, shown in coral, and works like a draft: the owner edits and resubmits.
- A week with no tasks can't be submitted.
- Work can't be logged for future dates, with one day of slack for time zones.
- Team Leads and Managers can log work on any project in their department. Developers only on projects they're assigned to. Completed projects take no new work.
- Bulk approve runs the normal single approval for each report, so every rule still applies.
- After requesting changes, the reviewer goes back to their inbox: a week sent back is the owner's draft again, which only the owner can see.
- The CEO doesn't log tasks, so the CEO's Tasks page is the export.

**Visibility**

- A Developer sees only their own work, even on a shared project.
- Counts that describe the process rather than the work are shown to the people responsible for it: whether someone has submitted this week (Team page, compliance, submission rate) and the Manager's approval funnel. Hours and task details still follow the approval gate.
- The CEO's figures use fully approved work only. A Manager's submitted week appears in the CEO's review queue for acknowledgement, but not in any figure until acknowledged.

**Notifications**

- An approval notifies only the next person in the chain, as the brief says. When the CEO acknowledges a Manager's week, the Manager gets an in-app notification.
- The live stream checks for new notifications every 5 seconds, which works on any MongoDB. Change streams would need a replica set.
- Turning off in-app notifications stops new ones being stored. Reminders are always stored, because that's how a reminder is never repeated.

**Projects**

- Any active person in the department can be a project member, not only Developers.
- Project codes are unique within a department, so two departments can share a code.
- Only a project with no logged work can be deleted. Otherwise it's marked Completed.

**AI**

- "Improve with AI" uses `claude-opus-5-5` at low effort, which is right for a short rewrite. The server-side fallback is on, so if the model declines a request, the API retries it on a fallback model inside the same call.
- The prompt treats the entry as text to rewrite, never as instructions.
- 30 requests per person per hour, up to 1000 characters each.

**Technical**

- Next.js 15 rather than 16, because Auth.js v5 is still in beta and this pairing is better tested.
- `bcryptjs` instead of native `bcrypt`: the same algorithm and format, with no native build on Windows.
- A standalone MongoDB has no multi-document transactions, so multi-step changes run in a safe order and undo by hand on failure. Unique indexes are the final guard against races.
- Rate limits are stored in MongoDB, so they hold across server instances.
- Lists are paginated. Two are bounded instead: a task range is capped at 62 days, and a person keeps at most 50 templates.
- ISO weeks run Monday to Sunday, and "late" means not submitted by Friday 4 PM server time.

**Design**

- Muted text directly on the page background uses `--muted-on-background` (`#636975`), because the specified `#6B7280` is 4.40:1 on `#F6F4EF`, just under WCAG AA. The specified value is kept on cards, where it passes.
- The 10-colour project palette can't all be told apart under colour blindness, which is expected for that many hues. Colour therefore never identifies anything alone: every swatch sits beside a name, and every chart has a text legend and tooltips.
- Pie charts show at most 8 slices, with the rest folded into "Other", so no two slices share a colour.
#   d a i l y - w o r k l o g  
 