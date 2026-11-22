import type { Role } from "@/lib/constants";

export type NavIcon =
  | "dashboard"
  | "tasks"
  | "projects"
  | "team"
  | "reviews"
  | "departments"
  | "users"
  | "site"
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  roles: readonly Role[];
}

const EVERYONE: readonly Role[] = ["SUPER_ADMIN", "CEO", "MANAGER", "TEAM_LEAD", "DEVELOPER"];
// The people in the approval chain. The Super Admin gives the IT department's final approval.
const APPROVERS: readonly Role[] = ["SUPER_ADMIN", "CEO", "MANAGER", "TEAM_LEAD"];
const ORG_WIDE: readonly Role[] = ["SUPER_ADMIN", "CEO"];

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", roles: EVERYONE },
  { href: "/tasks", label: "Tasks", icon: "tasks", roles: EVERYONE },
  { href: "/projects", label: "Projects", icon: "projects", roles: EVERYONE },
  { href: "/team", label: "Team", icon: "team", roles: [...ORG_WIDE, "MANAGER", "TEAM_LEAD"] },
  { href: "/reviews", label: "Reviews", icon: "reviews", roles: APPROVERS },
  { href: "/departments", label: "Departments", icon: "departments", roles: ORG_WIDE },
  { href: "/users", label: "Users", icon: "users", roles: ORG_WIDE },
  { href: "/site-settings", label: "Site settings", icon: "site", roles: ["SUPER_ADMIN"] },
  { href: "/settings", label: "Settings", icon: "settings", roles: EVERYONE },
];

export const navItemsFor = (role: Role) => NAV_ITEMS.filter((item) => item.roles.includes(role));
