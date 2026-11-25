# Architecture

For engineers working on GET List. Read this before adding an API route or a query.

## Department isolation

A Developer, Team Lead or Manager only ever reaches their own department's data. Only the CEO and the Super Admin see across departments (`seesAllDepartments` in `src/lib/constants.ts`). This is enforced on the server, in the query itself.

**Every query uses `scopeFor`** from [`src/lib/permissions`](../src/lib/permissions/index.ts):

| Caller                 | `scopeFor(user, selected)`                    |
| ---------------------- | --------------------------------------------- |
| CEO or Super Admin, no selection      | `{}`                           |
| CEO or Super Admin, switcher selected | `{ departmentId: selected }`   |
| Anyone else            | `{ departmentId: user.departmentId }`         |
| Unassigned manager     | `{ departmentId: { in: [] } }` (matches nothing) |

Three details matter:

- `selected` is ignored for everyone except the CEO and Super Admin, so a client can't widen its own scope.
- An unassigned manager must not get `{ departmentId: null }`, because that also matches the CEO and other unassigned managers.
- The result is a Prisma `where` fragment. Spread it into the `where` of any model that has a `departmentId`. For the Department table itself, use `departmentTableScope`.

`departmentId` is denormalised onto Project, Task, WeeklyReport and Notification, so scoping is always one indexed filter.

**Another department's record is a 404, never a 403**, so its existence isn't revealed. Check visibility first and role second, as in [`requireVisibleDepartment`](../src/lib/departments/access.ts).

## Adding an API route

1. Wrap the handler in `authedRoute` from [`src/lib/api/handler.ts`](../src/lib/api/handler.ts). It does the same-origin check, loads the session user fresh from the database, resolves `scope`, and produces the `{ error: { code, message } }` shape.
2. Spread `scope` into the `where` of every query.
3. Parse input with `parseBody` or `parseQuery` and a schema from `src/validators`.
4. Put authorisation rules in `src/lib/permissions`, not in the handler.
5. Add the route to `ROUTE_POLICIES` in [`tests/isolation.test.ts`](../tests/isolation.test.ts). **A test fails until you do**, so no route ships without an isolation decision. Add its cases to the same file, which runs in both directions between two departments.

## Authentication

- **Microsoft is the only way in.** There are no passwords. [`/api/auth/sso/entra/login`](../src/app/api/auth/sso/entra/login/route.ts) starts an OpenID Connect authorization code flow with PKCE against the tenant in `ENTRA_TENANT_ID`, and [`/callback`](../src/app/api/auth/sso/entra/callback/route.ts) checks the ID token's audience, tenant, issuer, expiry and nonce.
- **Microsoft proves who someone is; GET List decides whether they get in.** The callback hands the verified email to [`resolveMicrosoftSignIn`](../src/lib/users/access.ts):

  ```
  first sign-in ──▶ PENDING ──approve (role, department)──▶ APPROVED ──▶ session
                       └────────────reject──────────────▶ REJECTED
  ```

  A first sign-in creates a `PENDING` user, tells the Super Admins, and sends the person back to the sign-in page with a "waiting for approval" message. `approveUser` and `rejectUser` in the same file are what the Users page calls. Emails in `SUPER_ADMIN_EMAILS` skip the queue and are Super Admins from their first sign-in, which is how the first person gets in, and they can't be locked out.
- An approved person gets an ordinary Auth.js session, through a one-minute ticket signed with `AUTH_SECRET` ([`src/lib/auth/entra.ts`](../src/lib/auth/entra.ts)). Auth.js calls the provider that accepts it "credentials", but nobody types anything into it. The session is a JWT in an httpOnly cookie.
- `maySignIn` in `src/lib/permissions` is the one rule for holding a session: approved and active. `loadActiveUser` applies it on every request, so rejecting or deactivating someone takes effect on their next click.
- The JWT only proves identity. `getCurrentUser` reads role and department from the database on every request, so role changes, moves and deactivation apply immediately.
- [`middleware.ts`](../src/middleware.ts) only redirects signed-out page requests. It's a convenience, not a security boundary. API routes and pages each enforce access themselves.
- Role-gated pages call `requirePageRole`, which gives a real HTTP 404. Don't put a `loading.tsx` above a gated page: it starts streaming with status 200 before the guard runs.

## Org integrity

[`resolvePlacement`](../src/lib/users/service.ts) is the only place that decides where someone can sit:

- Super Admin and CEO: above the departments, with no department and no approver. Only a Super Admin can give or remove these two roles (`canAssignOrgWideRoles`), and nobody can change their own role.
- Manager: reports to the CEO, or to nobody until there is one. Gets a department only through department assignment, which approving a Manager can do in the same step.
- Team Lead: reports to their department's Manager. In the IT department that is the Super Admin.
- The IT department has no Manager. A Super Admin leads it (`Department.managerId` points at them, while they stay above the departments), its Team Leads report to them, and they give its reports the final approval. It is recognised by who leads it (`ledBySuperAdmin`), not by its name. `ensureItDepartment` creates it on a configured Super Admin's sign-in if no department is led by a Super Admin yet. Nobody can be assigned or approved as its Manager.
- Developer: reports to an active Team Lead in their department.

One manager per department is also enforced by a unique index on `Department.managerId`. There is at most one CEO: [`updateUser`](../src/lib/users/service.ts) refuses a second, and when the role moves it repoints the Managers and the weeks waiting for acknowledgement in the same transaction.

## Report workflow

One `WeeklyReport` per person per ISO week, created as a draft by the week's first task. The state machine is a pure function, [`nextTransition`](../src/lib/reports/workflow.ts), unit-tested on its own in [`tests/workflow.test.ts`](../tests/workflow.test.ts).

```
DRAFT ──submit──▶ SUBMITTED ──approve──▶ LEAD_APPROVED ──approve──▶ MANAGER_APPROVED
  ▲                   │                        │                    (final; the CEO can see it)
  └── owner edits ◀───┴─── request changes ────┘  CHANGES_REQUESTED
```

| Owner     | Submits to | Then                                                         |
| --------- | ---------- | ------------------------------------------------------------ |
| Developer | Team Lead  | Team Lead approves → Manager approves                        |
| Team Lead | Manager    | Manager approves: straight to `MANAGER_APPROVED`             |
| Manager   | CEO        | CEO acknowledges (`CEO_ACKNOWLEDGED` in the trail)           |

Rules, all enforced in [`transitionReport`](../src/lib/reports/service.ts):

- **Who can act:** only the owner submits, and only `currentApproverId` approves or requests changes. Requesting changes needs a comment.
- **Locking:** tasks can be added, edited or deleted only while the report is `DRAFT` or `CHANGES_REQUESTED`.
- **Races:** each step is one `UPDATE` conditioned on the status and approver that were read, so two approvers acting at once can't both succeed. The history entry and the tasks' `reportStatus` are written in the same transaction.
- **Audit trail:** every step adds a `ReportTrailEntry` row: `{ action, byUserId, at, comment }`.
- **Notifications:** submit notifies the approver. A Team Lead's approval notifies the Manager only. A Manager's final approval notifies the CEO only. A request for changes notifies the owner. Each is an in-app notification plus an email, following the recipient's preferences. See [Email](#email) for the one exception.

### Site settings

A Super Admin has a Site settings page (`/site-settings`), backed by [`src/lib/site-settings`](../src/lib/site-settings):

- **Approval chain:** unticking Team Lead exempts Team Leads from reviewing. A Developer's report then goes straight to the department's Manager (the Super Admin for the IT department), whose approval is final, and the Manager sees developers' work as soon as it's submitted. Saving the change moves reports that are waiting for a Team Lead on to the Manager. The switch is one row in the `SiteSetting` table.
- **Environment:** edits `.env.local`. Secret values are write-only: the page learns only whether each is set. A save keeps the previous file as `.env.backup.local`, updates the running server, and names the settings that need a restart (`DATABASE_URL`, `AUTH_SECRET`). On a host with a read-only file system the save is refused.

## Visibility rules

A report is visible to its owner and the person currently responsible for it. It moves up one level only when the approver clicks Done. Nobody higher can see it before then, including through the API.

[`src/lib/reports/visibility.ts`](../src/lib/reports/visibility.ts) builds this gate as query clauses, so gated data is never fetched:

| Viewer    | Sees                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| Developer | Their own work                                                                           |
| Team Lead | Their own, and direct reports' once submitted (never drafts)                             |
| Manager   | Their own, Team Leads' once submitted, and developers' once the Team Lead has approved   |
| CEO, Super Admin | `MANAGER_APPROVED` only                                                           |

It has three entry points:

- `visibleReportsFilter` and `visibleTasksFilter` are for work data: dashboards, project pages, exports and the Team page's hours. Tasks carry a copy of their report's status, `reportStatus`, so the gate is one indexed filter with no join. The workflow updates it in the same transaction as the report.
- `openableReportsFilter` is for opening a report. It adds "waiting for me", which is how a Manager's submitted week reaches the CEO without ever counting in the CEO's approved-only figures.
- A week sent back (`CHANGES_REQUESTED`) is visible to its owner only, like a draft.

Projects have a separate rule, [`projectScope`](../src/lib/permissions/index.ts): Developers see only projects they're assigned to, and everyone else follows the department scope. Logging work uses the same rule, so a Developer can't log time on a project they aren't assigned to.

## Email

Mail goes through SendGrid's Mail Send API ([`src/lib/email`](../src/lib/email/index.ts)), from the verified sender in `SENDGRID_FROM_EMAIL`. Most mail is sent by [`notify`](../src/lib/notifications/index.ts), beside the in-app notification. The two messages to people who can't see the app yet (approved, or added ahead of time) are sent directly:

| Event | Who is emailed |
| ----- | -------------- |
| Someone is assigned to a project (on creation, or added later) | Each newly assigned person, except whoever made the assignment |
| A week is submitted | The owner's approver: a Developer's Team Lead, a Team Lead's Manager |
| A Team Lead approves a Developer's week | The Manager |
| Changes are requested | The week's owner |
| Friday 4 PM, week not submitted; a review waiting over two days | The person, or the approver |
| Someone signs in for the first time and is waiting | Every Super Admin |
| A waiting person is approved, or someone is added ahead of time | That person |

**The CEO is never emailed.** `receivesEmail` in `notify` drops the email for anyone with the CEO role, whatever their preferences, so a Manager's submitted week and every final approval reach the CEO in the app only. Everyone else can turn email off in Settings.

## Data model

PostgreSQL through Prisma. The schema is [`prisma/schema.prisma`](../prisma/schema.prisma) and changes are SQL migrations in `prisma/migrations`, applied by `npm run db:migrate`.

- Ids are UUIDs. Calendar days (task dates, week bounds) are `DATE` columns, read as midnight UTC.
- A project's people are `ProjectMember` rows. A report's per-project totals are `ReportProjectTotal` rows and its history is `ReportTrailEntry` rows.
- Two indexes can't be written in the Prisma schema and live in the first migration's SQL: the case-insensitive unique department name, and one synced task per person, project and day.
- A project's latest dependency audit is one `ProjectAudit` row, written by [`src/lib/audit/service.ts`](../src/lib/audit/service.ts). It has no `departmentId`: read it through its project, with `projectScope`. A failed check keeps the last result and sets `error`.
- A department's own Bitbucket account is one `BitbucketConnection` row, saved by its manager on the Settings page ([`src/lib/bitbucket/connection.ts`](../src/lib/bitbucket/connection.ts)). The token is stored encrypted with AES-256-GCM under a key derived from `AUTH_SECRET` ([`src/lib/crypto/secret-box.ts`](../src/lib/crypto/secret-box.ts)) and is never sent to the browser; changing `AUTH_SECRET` means entering it again. The audit reads a department's repositories with this account, and otherwise with the site-wide `BITBUCKET_TOKEN`. The Projects page offers the manager an import: one project per repository that doesn't have one yet (`POST /api/projects/import`). The row is deleted when the department gets a new manager.
- Import the client from [`src/lib/db/prisma.ts`](../src/lib/db/prisma.ts). There is nothing to connect: it opens its pool on first use.

## Live notifications

`GET /api/notifications/stream` is a Server-Sent Events stream for the signed-in user. It checks the database every 5 seconds, which needs no extra infrastructure, and sends new notifications and the unread count. The bell uses it, and falls back to polling every 30 seconds whenever the stream is down.

## Tests

- `tests/*.test.ts` (Vitest, against a `worklog_test` PostgreSQL database that is created and migrated on first use) call the real route handlers with a mocked session.
- [`tests/isolation.test.ts`](../tests/isolation.test.ts) runs each department check in both directions between IT and HR, for every role, and fails if any API route is missing from its policy table.
- `e2e/*.spec.ts` (Playwright) run a production build against a seeded `worklog_e2e` database, including the full submit → approve → request-changes chain.

## Known limits

- A workflow step (the report, its history entry and its tasks' `reportStatus`), a change of manager and creating a department each run in one database transaction. Notifications and emails are sent after it commits, so a crash at that moment could lose a notification but never leaves a half-applied change.
- An email failure is logged and doesn't fail the request, because the change has already been saved. Nothing depends on an email arriving: the person can simply sign in, and Super Admins see who is waiting on the Users page.
