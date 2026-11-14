import { Types, type FilterQuery } from "mongoose";
import type { ReportStatus } from "@/lib/constants";
import type { Actor } from "@/lib/permissions";
import { User, type ITask, type IWeeklyReport } from "@/models";

const WITH_DIRECT_APPROVER: ReportStatus[] = ["SUBMITTED", "LEAD_APPROVED", "MANAGER_APPROVED"];
const PAST_TEAM_LEAD: ReportStatus[] = ["LEAD_APPROVED", "MANAGER_APPROVED"];

/**
 * The approval gate as query clauses, for either collection. `statusField` is `status` on
 * WeeklyReport and its copy, `reportStatus`, on Task.
 * - Everyone but the CEO sees their own work in any state.
 * - A direct approver sees work once it's submitted, never while it's a draft.
 * - A Manager sees developers' work only after the Team Lead has approved it.
 * - The CEO sees only fully approved work.
 */
async function gateClauses(actor: Actor, statusField: "status" | "reportStatus") {
  if (actor.role === "CEO") return [{ [statusField]: "MANAGER_APPROVED" }];

  const self = new Types.ObjectId(actor.id);
  const own = { userId: self };
  if (actor.role === "DEVELOPER" || !actor.departmentId) return [own];

  const departmentId = new Types.ObjectId(actor.departmentId);
  const directReports = await User.find({ reportsTo: self, departmentId }).distinct("_id");
  const clauses: Record<string, unknown>[] = [
    own,
    { departmentId, userId: { $in: directReports }, [statusField]: { $in: WITH_DIRECT_APPROVER } },
  ];
  if (actor.role === "MANAGER") {
    clauses.push({ departmentId, [statusField]: { $in: PAST_TEAM_LEAD } });
  }
  return clauses;
}

/**
 * Work data a viewer may see, for dashboards, project pages and exports. Use it inside the query,
 * so gated data is never fetched. For the CEO this is strictly fully approved work.
 */
export async function visibleReportsFilter(actor: Actor): Promise<FilterQuery<IWeeklyReport>> {
  const clauses = await gateClauses(actor, "status");
  return clauses.length === 1 ? clauses[0]! : { $or: clauses };
}

export async function visibleTasksFilter(actor: Actor): Promise<FilterQuery<ITask>> {
  const clauses = await gateClauses(actor, "reportStatus");
  return clauses.length === 1 ? clauses[0]! : { $or: clauses };
}

/**
 * Reports a viewer may open: the gate above, plus any report currently waiting for them. This is
 * how a Manager's submitted report reaches the CEO for acknowledgement without ever counting in
 * the CEO's approved-only figures.
 */
export async function openableReportsFilter(actor: Actor): Promise<FilterQuery<IWeeklyReport>> {
  return {
    $or: [
      ...(await gateClauses(actor, "status")),
      { currentApproverId: new Types.ObjectId(actor.id) },
    ],
  };
}
