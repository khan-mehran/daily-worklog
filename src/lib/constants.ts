// Client-safe enums and labels. Nothing in this file may import server code.

export const ROLES = ["CEO", "MANAGER", "TEAM_LEAD", "DEVELOPER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  CEO: "CEO",
  MANAGER: "Manager",
  TEAM_LEAD: "Team Lead",
  DEVELOPER: "Developer",
};

/** The role a user of each role must report to. */
export const REPORTS_TO_ROLE: Record<Role, Role | null> = {
  CEO: null,
  MANAGER: "CEO",
  TEAM_LEAD: "MANAGER",
  DEVELOPER: "TEAM_LEAD",
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

export const DEPARTMENT_FILTER_COOKIE = "worklog-department";
