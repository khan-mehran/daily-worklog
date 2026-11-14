import { Types } from "mongoose";
import type { Role } from "@/lib/constants";

/** The authorisation subject. Always loaded from the database, never taken from the client. */
export interface Actor {
  id: string;
  role: Role;
  departmentId: string | null;
}

export type DepartmentScope = { departmentId?: Types.ObjectId | { $in: never[] } };

const MATCH_NOTHING: DepartmentScope = { departmentId: { $in: [] } };

/**
 * The department filter for every Mongoose query and aggregation $match.
 *
 * - CEO: {} (all departments), or one department when the switcher has one selected.
 * - Everyone else: their own department. `selectedDepartmentId` is ignored for them.
 * - A manager with no department yet sees nothing. `{ departmentId: null }` would be wrong here
 *   because it also matches the CEO and other unassigned managers.
 *
 * Values are real ObjectIds because aggregation pipelines do not cast strings.
 */
export function scopeFor(actor: Actor, selectedDepartmentId?: string | null): DepartmentScope {
  if (actor.role === "CEO") {
    return selectedDepartmentId && Types.ObjectId.isValid(selectedDepartmentId)
      ? { departmentId: new Types.ObjectId(selectedDepartmentId) }
      : {};
  }
  return actor.departmentId
    ? { departmentId: new Types.ObjectId(actor.departmentId) }
    : MATCH_NOTHING;
}

/** The same rule for the Department collection, whose department id is `_id`. */
export function departmentCollectionScope(actor: Actor): {
  _id?: Types.ObjectId | { $in: never[] };
} {
  if (actor.role === "CEO") return {};
  return actor.departmentId ? { _id: new Types.ObjectId(actor.departmentId) } : { _id: { $in: [] } };
}

/**
 * The filter for the Project collection: the department scope, and for developers only the
 * projects they're assigned to. Team Leads and Managers see all of their department's projects.
 */
export function projectScope(actor: Actor, selectedDepartmentId?: string | null) {
  const scope = scopeFor(actor, selectedDepartmentId);
  return actor.role === "DEVELOPER"
    ? { ...scope, memberIds: new Types.ObjectId(actor.id) }
    : scope;
}

export const isCEO = (actor: Pick<Actor, "role">) => actor.role === "CEO";

/** The CEO sees every project but is read-only. Developers only work within their projects. */
export const canManageProjects = (actor: Pick<Actor, "role">) =>
  actor.role === "MANAGER" || actor.role === "TEAM_LEAD";

export const canManageDepartments = isCEO;
export const canManageUsers = isCEO;
export const canAccessAdmin = isCEO;

/** Team and Reviews pages, and the department people directory. */
export const canViewPeople = (actor: Pick<Actor, "role">) => actor.role !== "DEVELOPER";

/** Developers may read only their own user record. */
export function canViewUser(
  actor: Actor,
  target: { _id: Types.ObjectId | string; departmentId: Types.ObjectId | string | null },
) {
  if (isCEO(actor)) return true;
  if (String(target._id) === actor.id) return true;
  if (actor.role === "DEVELOPER" || !actor.departmentId || !target.departmentId) return false;
  return String(target.departmentId) === actor.departmentId;
}
