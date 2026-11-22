// Client-safe enums and labels. Nothing in this file may import server code.

// In seniority order, as in the database enum.
export const ROLES = ["SUPER_ADMIN", "CEO", "MANAGER", "TEAM_LEAD", "DEVELOPER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  CEO: "CEO",
  MANAGER: "Manager",
  TEAM_LEAD: "Team Lead",
  DEVELOPER: "Developer",
};

/** The role a user of each role must report to. */
export const REPORTS_TO_ROLE: Record<Role, Role | null> = {
  SUPER_ADMIN: null,
  CEO: null,
  MANAGER: "CEO",
  TEAM_LEAD: "MANAGER",
  DEVELOPER: "TEAM_LEAD",
};

/**
 * The roles outside the departments. The Super Admin runs the system: who may sign in, with which
 * role, in which department. The CEO is the top of the approval chain. Both see every department,
 * and neither logs work.
 */
export const ORG_WIDE_ROLES = ["SUPER_ADMIN", "CEO"] as const satisfies readonly Role[];
export const seesAllDepartments = (role: Role) => role === "SUPER_ADMIN" || role === "CEO";

/** Whether a Super Admin has let someone in. A first Microsoft sign-in starts as PENDING. */
export const APPROVALS = ["PENDING", "APPROVED", "REJECTED"] as const;
export type Approval = (typeof APPROVALS)[number];

export const APPROVAL_LABELS: Record<Approval, string> = {
  PENDING: "Waiting for approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const PALETTE = [
  "teal",
  "coral",
  "yellow",
  "violet",
  "sky",
  "pink",
  "lime",
  "orange",
  "indigo",
  "slate",
] as const;
export type PaletteColor = (typeof PALETTE)[number];

export const paletteVar = (color: PaletteColor | string) => `var(--palette-${color})`;

export const DEPARTMENT_STATUSES = ["Active", "Archived"] as const;
export type DepartmentStatus = (typeof DEPARTMENT_STATUSES)[number];

export const PROJECT_STATUSES = ["Active", "On hold", "Completed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ["Completed", "In Progress", "Blocked"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_SOURCES = ["manual", "sync"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const SYNC_ORIGINS = ["items", "activity"] as const;
export type SyncOrigin = (typeof SYNC_ORIGINS)[number];

export const REPORT_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "LEAD_APPROVED",
  "MANAGER_APPROVED",
  "CHANGES_REQUESTED",
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  LEAD_APPROVED: "Lead approved",
  MANAGER_APPROVED: "Manager approved",
  CHANGES_REQUESTED: "Changes requested",
};

/** Reports in these states have been handed in and not sent back. */
export const SUBMITTED_STATUSES: readonly ReportStatus[] = [
  "SUBMITTED",
  "LEAD_APPROVED",
  "MANAGER_APPROVED",
];

/** A report in these states belongs to its owner, who can still change its tasks. */
export const EDITABLE_STATUSES: readonly ReportStatus[] = ["DRAFT", "CHANGES_REQUESTED"];

export const THEMES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEMES)[number];

export const DEPARTMENT_FILTER_COOKIE = "getl-department";
