import type { Prisma } from "@prisma/client";
import { seesAllDepartments, type ReportStatus } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import type { Actor } from "@/lib/permissions";
import { getApprovalSettings } from "@/lib/site-settings/service";

const WITH_DIRECT_APPROVER: ReportStatus[] = ["SUBMITTED", "LEAD_APPROVED", "MANAGER_APPROVED"];
const PAST_TEAM_LEAD: ReportStatus[] = ["LEAD_APPROVED", "MANAGER_APPROVED"];

type Clause = Record<string, unknown>;

/**
 * The approval gate as `where` clauses, for either table. `statusField` is `status` on
 * WeeklyReport and its copy, `reportStatus`, on Task.
 * - Everyone but the CEO sees their own work in any state.
 * - A direct approver sees work once it's submitted, never while it's a draft.
 * - A Manager sees developers' work only after the Team Lead has approved it. When Site settings
 *   exempts Team Leads from reviewing, that is as soon as it's submitted.
 * - The CEO and Super Admin see only fully approved work.
 */
async function gateClauses(actor: Actor, statusField: "status" | "reportStatus"): Promise<Clause[]> {
  if (seesAllDepartments(actor.role)) return [{ [statusField]: "MANAGER_APPROVED" }];

  const own = { userId: actor.id };
  if (actor.role === "DEVELOPER" || !actor.departmentId) return [own];

  const departmentId = actor.departmentId;
  const directReports = await prisma.user.findMany({
    where: { reportsTo: actor.id, departmentId },
    select: { id: true },
  });
  const clauses: Clause[] = [
    own,
    {
      departmentId,
      userId: { in: directReports.map((person) => person.id) },
      [statusField]: { in: WITH_DIRECT_APPROVER },
    },
  ];
  if (actor.role === "MANAGER") {
    const { teamLeadReview } = await getApprovalSettings();
    clauses.push({ departmentId, [statusField]: { in: teamLeadReview ? PAST_TEAM_LEAD : WITH_DIRECT_APPROVER } });
  }
  return clauses;
}

const anyOf = (clauses: Clause[]) => (clauses.length === 1 ? clauses[0]! : { OR: clauses });

/**
 * Work data a viewer may see, for dashboards, project pages and exports. Use it inside the query,
 * so gated data is never fetched. For the CEO this is strictly fully approved work.
 */
export async function visibleReportsFilter(actor: Actor): Promise<Prisma.WeeklyReportWhereInput> {
  return anyOf(await gateClauses(actor, "status"));
}

export async function visibleTasksFilter(actor: Actor): Promise<Prisma.TaskWhereInput> {
  return anyOf(await gateClauses(actor, "reportStatus"));
}

/**
 * Reports a viewer may open: the gate above, plus any report currently waiting for them. This is
 * how a Manager's submitted report reaches the CEO for acknowledgement without ever counting in
 * the CEO's approved-only figures.
 */
export async function openableReportsFilter(actor: Actor): Promise<Prisma.WeeklyReportWhereInput> {
  return { OR: [...(await gateClauses(actor, "status")), { currentApproverId: actor.id }] };
}
