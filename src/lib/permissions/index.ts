import { seesAllDepartments, type Role } from "@/lib/constants";
import { isId } from "@/validators/common";

/** The authorisation subject. Always loaded from the database, never taken from the client. */
export interface Actor {
  id: string;
  role: Role;
  departmentId: string | null;
}

export type DepartmentScope = { departmentId?: string | { in: string[] } };

const MATCH_NOTHING: DepartmentScope = { departmentId: { in: [] } };

/**
 * The department filter for every Prisma `where`.
 *
 * - CEO and Super Admin: {} (all departments), or one department when the switcher has one
 *   selected.
 * - Everyone else: their own department. `selectedDepartmentId` is ignored for them.
 * - A manager with no department yet sees nothing. `{ departmentId: null }` would be wrong here
 *   because it also matches the CEO and other unassigned managers.
 */
export function scopeFor(actor: Actor, selectedDepartmentId?: string | null): DepartmentScope {
  if (seesAllDepartments(actor.role)) {
    return selectedDepartmentId && isId(selectedDepartmentId) ? { departmentId: selectedDepartmentId } : {};
  }
  return actor.departmentId ? { departmentId: actor.departmentId } : MATCH_NOTHING;
}

/** The same rule for the Department table, whose department id is `id`. */
export function departmentTableScope(actor: Actor): { id?: string | { in: string[] } } {
  if (seesAllDepartments(actor.role)) return {};
  return actor.departmentId ? { id: actor.departmentId } : { id: { in: [] } };
}

/**
 * The filter for the Project table: the department scope, and for developers only the
 * projects they're assigned to. Team Leads and Managers see all of their department's projects.
 */
export function projectScope(actor: Actor, selectedDepartmentId?: string | null) {
  const scope = scopeFor(actor, selectedDepartmentId);
  return actor.role === "DEVELOPER" ? { ...scope, members: { some: { userId: actor.id } } } : scope;
}

/** Who may hold a session: someone a Super Admin has approved and nobody has deactivated. */
export const maySignIn = (user: { isActive: boolean; approval: string }) =>
  user.isActive && user.approval === "APPROVED";

export const isCEO = (actor: Pick<Actor, "role">) => actor.role === "CEO";
export const isSuperAdmin = (actor: Pick<Actor, "role">) => actor.role === "SUPER_ADMIN";
/** The CEO or a Super Admin: everyone who sees across departments. */
export const isOrgWide = (actor: Pick<Actor, "role">) => seesAllDepartments(actor.role);

/** The CEO and Super Admin see every project but are read-only. Developers only work within theirs. */
export const canManageProjects = (actor: Pick<Actor, "role">) =>
  actor.role === "MANAGER" || actor.role === "TEAM_LEAD";

export const canManageDepartments = isOrgWide;
/** The Users page: adding people, approving sign-ins, roles and departments. */
export const canManageUsers = isOrgWide;
/** Only a Super Admin hands out, or takes away, the two roles above the departments. */
export const canAssignOrgWideRoles = isSuperAdmin;

/** Team and Reviews pages, and the department people directory. */
export const canViewPeople = (actor: Pick<Actor, "role">) => actor.role !== "DEVELOPER";

/** Developers may read only their own user record. */
export function canViewUser(actor: Actor, target: { id: string; departmentId: string | null }) {
  if (isOrgWide(actor)) return true;
  if (target.id === actor.id) return true;
  if (actor.role === "DEVELOPER" || !actor.departmentId || !target.departmentId) return false;
  return target.departmentId === actor.departmentId;
}
