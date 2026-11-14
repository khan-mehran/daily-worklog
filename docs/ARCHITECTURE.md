# Architecture

For engineers working on WorkLog. Read this before adding an API route or a query.

## Department isolation

A Developer, Team Lead or Manager only ever reaches their own department's data. Only the CEO sees across departments. This is enforced on the server, in the query itself.

**Every query uses `scopeFor`** from [`src/lib/permissions`](../src/lib/permissions/index.ts):

| Caller                 | `scopeFor(user, selected)`                    |
| ---------------------- | --------------------------------------------- |
| CEO, no selection      | `{}`                                          |
| CEO, switcher selected | `{ departmentId: selected }`                  |
| Anyone else            | `{ departmentId: user.departmentId }`         |
| Unassigned manager     | `{ departmentId: { $in: [] } }` (matches nothing) |

Three details matter:

- `selected` is ignored for everyone except the CEO, so a client can't widen its own scope.
- An unassigned manager must not get `{ departmentId: null }`, because that also matches the CEO and other unassigned managers.
- Values are real ObjectIds, because aggregation pipelines don't cast strings the way `find` does.

`departmentId` is denormalised onto Project, Task, WeeklyReport and Notification, so scoping is always one indexed filter.

**Another department's record is a 404, never a 403**, so its existence isn't revealed. Check visibility first and role second, as in [`requireVisibleDepartment`](../src/lib/departments/access.ts).

## Adding an API route

1. Wrap the handler in `authedRoute` from [`src/lib/api/handler.ts`](../src/lib/api/handler.ts). It does the same-origin check, loads the session user fresh from the database, resolves `scope`, and produces the `{ error: { code, message } }` shape.
2. Spread `scope` into every query and `$match`.
3. Parse input with `parseBody` or `parseQuery` and a schema from `src/validators`.
4. Put authorisation rules in `src/lib/permissions`, not in the handler.
5. Add the route to `ROUTE_POLICIES` in [`tests/isolation.test.ts`](../tests/isolation.test.ts). **A test fails until you do**, so no route ships without an isolation decision. Add its cases to the same file, which runs in both directions between two departments.

## Authentication

- Auth.js credentials provider with bcrypt and a JWT session in an httpOnly cookie.
- The JWT only proves identity. `getCurrentUser` reads role and department from the database on every request, so role changes, moves and deactivation apply immediately.
- [`middleware.ts`](../src/middleware.ts) only redirects signed-out page requests. It's a convenience, not a security boundary. API routes and pages each enforce access themselves.
- Role-gated pages call `requirePageRole`, which gives a real HTTP 404. Don't put a `loading.tsx` above a gated page: it starts streaming with status 200 before the guard runs.

## Org integrity

[`resolvePlacement`](../src/lib/users/service.ts) is the only place that decides where someone can sit:

- Manager: reports to the CEO. Gets a department only through department assignment.
- Team Lead: reports to their department's Manager.
- Developer: reports to an active Team Lead in their department.

One manager per department is also enforced by a partial unique index on `Department.managerId`.

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
- **Races:** each step is one `findOneAndUpdate` conditioned on the status and approver that were read, so two approvers acting at once can't both succeed.
- **Audit trail:** every step appends `{ action, byUserId, at, comment }` to `approvalTrail`.
- **Notifications:** submit notifies the approver. A Team Lead's approval notifies the Manager only. A Manager's final approval notifies the CEO only. A request for changes notifies the owner. Each is an in-app notification plus an email, following the recipient's preferences.

## Visibility rules

A report is visible to its owner and the person currently responsible for it. It moves up one level only when the approver clicks Done. Nobody higher can see it before then, including through the API.

[`src/lib/reports/visibility.ts`](../src/lib/reports/visibility.ts) builds this gate as query clauses, so gated data is never fetched:

| Viewer    | Sees                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| Developer | Their own work                                                                           |
| Team Lead | Their own, and direct reports' once submitted (never drafts)                             |
| Manager   | Their own, Team Leads' once submitted, and developers' once the Team Lead has approved   |
| CEO       | `MANAGER_APPROVED` only                                                                  |

It has three entry points:

- `visibleReportsFilter` and `visibleTasksFilter` are for work data: dashboards, project pages, exports and the Team page's hours. Tasks carry a copy of their report's status, `reportStatus`, so the gate is one indexed filter with no join. The workflow updates it on every step, and `npm run db:migrate` backfills it.
- `openableReportsFilter` is for opening a report. It adds "waiting for me", which is how a Manager's submitted week reaches the CEO without ever counting in the CEO's approved-only figures.
- A week sent back (`CHANGES_REQUESTED`) is visible to its owner only, like a draft.

Projects have a separate rule, [`projectScope`](../src/lib/permissions/index.ts): Developers see only projects they're assigned to, and everyone else follows the department scope. Logging work uses the same rule, so a Developer can't log time on a project they aren't assigned to.

## Live notifications

`GET /api/notifications/stream` is a Server-Sent Events stream for the signed-in user. It checks MongoDB every 5 seconds, which works without a replica set, and sends new notifications and the unread count. The bell uses it, and falls back to polling every 30 seconds whenever the stream is down.

## Tests

- `tests/*.test.ts` (Vitest, in-memory MongoDB) call the real route handlers with a mocked session.
- [`tests/isolation.test.ts`](../tests/isolation.test.ts) runs each department check in both directions between IT and HR, for every role, and fails if any API route is missing from its policy table.
- `e2e/*.spec.ts` (Playwright) run a production build against a seeded `worklog_e2e` database, including the full submit → approve → request-changes chain.

## Known limits

- MongoDB transactions need a replica set, and the local setup is standalone. Multi-step changes such as changing a manager run in a safe order with manual undo, so a crash between steps could leave a partial change. Moving to Atlas makes real transactions possible.
- The workflow also makes several writes in order (report, then its tasks' `reportStatus`, then notifications). If the server stopped between them, `npm run db:migrate` would re-sync the task statuses.
- An email failure is logged and doesn't fail the request, because the change has already been saved. An invite that fails to send can be resent through `POST /api/users/:id/invite`.
