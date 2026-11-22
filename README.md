# GET List (Gord Employee Task List)

Role-based work reporting and approvals. It replaces the manual Excel process (Developer → Team Lead → Manager → CEO) across departments, with strict data isolation between them.

**Status:** all 8 phases are built. See [What's in it](#whats-in-it).

## Setup

You need Node 20.9 or newer and PostgreSQL.

```bash
npm install
cp .env.example .env.local      # then fill it in: see the sections below
docker compose up -d            # PostgreSQL (skip if PostgreSQL is already installed)
npm run db:migrate              # creates the tables
npm run dev
```

The app is at <http://localhost:3000>. If that port is taken, Next.js picks the next free one and prints it. In that case, set `APP_URL` in `.env.local` to the same address, so email links point at GET List.

**Already have PostgreSQL installed?** Skip `docker compose up -d`, create an empty database (`createdb worklog`) and point `DATABASE_URL` at it.

**Upgrading an existing database?** Run `npm run db:migrate`. It applies the migrations in `prisma/migrations` that the database hasn't had yet and keeps your data. `npm run db:studio` opens a browser for the data.

### Signing in

Everyone signs in with their Microsoft account. There are no passwords in GET List.

1. Set the four `ENTRA_*` values in `.env.local` from an app registration in Microsoft Entra ID, and register `<APP_URL>/api/auth/sso/entra/callback` on it as a **Web** redirect URI. Only accounts from the tenant in `ENTRA_TENANT_ID` can sign in.
2. Put your own email in `SUPER_ADMIN_EMAILS`. The people listed there become **Super Admins** the first time they sign in, with no waiting. That's how the first person gets in.
3. Anyone else who signs in gets an account that **waits for approval**, and sees a message saying so on the sign-in page. Super Admins are told in the app and by email.
4. On the **Users** page, a Super Admin clicks **Approve** in the Action column and chooses the person's role, their department and, for a Developer, their Team Lead. Or **Reject**. An approved person is emailed and can sign in straight away.

A fresh database is empty, so the first Super Admin starts by approving people. A workable order: approve the CEO, approve a Manager, add a department for that Manager (Users or Departments page), then approve Team Leads and Developers into it. People can also be added ahead of time with **Add user**: they're approved from the start and are emailed to sign in.

### Email

Emails go through SendGrid. Set `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL`, which must be a sender verified in the SendGrid account. Without a key, emails are logged as failed and the app carries on.

People are emailed when they're assigned to a project, when a week is waiting for their review, when changes are requested on their week, and for reminders. **The CEO is never emailed** and follows everything in the app instead. Everyone else can turn email off in Settings.

### Optional settings

- `ANTHROPIC_API_KEY`: turns on "Improve with AI". Without it, the button explains it isn't set up, and saving still works.
- `CRON_SECRET`: protects the reminders endpoint. See [Reminders](#reminders).

## Roles

| Role | Sees | Does |
| ---- | ---- | ---- |
| Super Admin | All departments, with a switcher | Approves sign-ins, sets roles and departments, manages departments. Logs no work and reviews none. The only one who can give or take away the Super Admin and CEO roles |
| CEO | All departments, with a switcher, fully approved work only | Acknowledges Managers' weeks. Can also manage users and departments. Is never emailed |
| Manager | Their own department | Approves Team Leads' weeks, and Developers' weeks after the Team Lead |
| Team Lead | Their own department | Approves their Developers' weeks. Manages projects |
| Developer | Their own work, on projects they're assigned to | Logs tasks and submits each week |

**To see the whole workflow:** as a Developer, add a task on the Tasks page (or press **N**), then use **Submit week** on the Weekly tab. Their Team Lead approves it from **Reviews**, then the Manager. The CEO only sees it after the Manager's approval.

### Demo data

`npm run seed` **erases the database** and loads a demo company: five departments, 26 people at `@getl.demo` (one of them waiting for approval) and six weeks of work. It's what the browser tests run against. Those accounts have no Microsoft identity, so nobody can sign in as them in the app itself: use it to try queries and screens, not on a database you want to keep.

## What's in it

| Area | Highlights |
| ---- | ---------- |
| Tasks | Daily, Weekly and Monthly tabs. Add Task with templates, copy the previous day, and **N** to add |
| Workflow | Submit, approve ("Done") and request changes with a comment. Tasks lock once submitted. Full review history |
| Reviews | Inbox of weeks waiting for you, oldest first, with bulk approve. Blocked tasks highlighted |
| Dashboards | One per role, following the top bar's date range. The CEO's uses fully approved work only |
| Projects | Create, assign people, status, colour and dates. Developers see only their own projects |
| Departments | Add with a manager (existing, or added by email), edit, change manager, archive |
| Sign-in | Microsoft Entra ID only. A first sign-in waits for a Super Admin's approval |
| Users | Everyone who has signed in, with their status. Approve or reject from the Action column, with dropdowns for role, department and Team Lead. Edit, deactivate, or add people ahead of time |
| Notifications | Bell with live updates (Server-Sent Events, with 30-second polling as a fallback), full history, and emails through SendGrid for project assignments, reviews and reminders |
| Export | Excel with Tasks and Summary sheets, filtered by people, project, dates and report status. Owners can download one week |
| AI | "Improve with AI" in the task form, with a side-by-side diff and Accept, Edit or Discard |
| Search | **Ctrl+K** or **Cmd+K**: pages, projects, people and your own tasks |
| Other | Team page, settings (profile, theme, notification preferences), reminders, light and dark themes |

## Commands

| Command              | What it does                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `npm run dev`        | Start the development server                                              |
| `npm run seed`       | **Erase the database's data** and load the demo company. Refuses to run in production |
| `npm run db:migrate` | Apply the migrations the database hasn't had yet, keeping its data        |
| `npm run db:migrate:new` | After editing `prisma/schema.prisma`: write a new migration and apply it |
| `npm run db:studio`  | Browse the data in Prisma Studio                                          |
| `npm run cron`       | Run the reminders every hour, for self-hosting                            |
| `npm test`           | Unit and API tests, against their own `worklog_test` database, created on first use |
| `npm run test:e2e`   | Browser tests: builds the app into `.next-e2e`, serves it on port 3100 and uses its own `worklog_e2e` database. Needs PostgreSQL running and about 3 GB of free memory |
| `npm run typecheck`  | TypeScript check                                                          |
| `npm run lint`       | ESLint                                                                    |
| `npm run format`     | Prettier                                                                  |

## Reminders

`GET /api/cron/reminders` with the header `Authorization: Bearer <CRON_SECRET>`:

- On Thursday from 6 PM, it submits the week for every Developer and Team Lead who hasn't. The report follows the normal approval route, and both the owner and the approver are told. Weeks with no tasks, and reports sent back for changes, are left alone.
- From Friday 4 PM, it reminds everyone who hasn't submitted the week.
- Every run, it reminds approvers about weeks waiting more than two days.

It never sends the same reminder or submits the same report twice, so it's safe to run often. All times are server time.

- **On Vercel:** `vercel.json` already schedules it: Thursday 18:00 UTC (the auto-submit), Friday 13:00 UTC (4 PM in Qatar) and daily at 06:00 UTC. Vercel's clock is UTC, so there the auto-submit runs at 9 PM in Qatar. Set `CRON_SECRET` in the project.
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
prisma           The database schema and its SQL migrations
src/validators   Zod schemas shared by client and server
src/hooks        Shared React hooks
scripts          seed, cron, and helpers for the Prisma CLI and test databases
tests            Vitest unit and API tests
e2e              Playwright browser tests
docs             Architecture: isolation, the workflow state machine and visibility rules
```

How isolation, authorisation and the workflow work: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Assumptions

Decisions made where the brief left room. Each is easy to change.

**Org structure**

- Super Admins sit outside the org chart. They come from `SUPER_ADMIN_EMAILS`, or from another Super Admin, and can't change their own role or deactivate themselves.
- There is at most one CEO. Only a Super Admin can give or take away that role. When the CEO changes, the Managers and the weeks waiting for acknowledgement move to the new CEO.
- A Manager approved before there is a CEO reports to nobody until one is assigned, and can't submit a week until then.
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
- The CEO is the chairman of the approval chain and is never emailed: what reaches the CEO shows in the app only.
- Someone assigned to a project is told in the app and by email. Whoever made the assignment isn't told about adding themselves.
- The live stream checks for new notifications every 5 seconds, which needs no extra infrastructure.
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
- PostgreSQL through Prisma. Multi-step changes (a workflow step, changing a manager, creating a department) run in one transaction, and unique indexes are the final guard against races.
- Microsoft proves who someone is, and nothing more. A first sign-in creates an account with no access, which a Super Admin approves or rejects, so access and roles are always decided in GET List.
- Browser tests can't go through Microsoft. They finish a sign-in the way the real callback does, with a ticket signed with `AUTH_SECRET` (`e2e/sign-in.ts`), so nothing in the app is switched off for tests.
- Rate limits are stored in PostgreSQL, so they hold across server instances.
- Lists are paginated. Two are bounded instead: a task range is capped at 62 days, and a person keeps at most 50 templates.
- ISO weeks run Monday to Sunday, and "late" means not submitted by Friday 4 PM server time.

**Design**

- Muted text directly on the page background uses `--muted-on-background` (`#636975`), because the specified `#6B7280` is 4.40:1 on `#F6F4EF`, just under WCAG AA. The specified value is kept on cards, where it passes.
- The 10-colour project palette can't all be told apart under colour blindness, which is expected for that many hues. Colour therefore never identifies anything alone: every swatch sits beside a name, and every chart has a text legend and tooltips.
- Pie charts show at most 8 slices, with the rest folded into "Other", so no two slices share a colour.
#   d a i l y - w o r k l o g  
 