import type { Role } from "@/lib/constants";

export type NavIcon =
  | "dashboard"
  | "tasks"
  | "projects"
  | "team"
  | "reviews"
  | "departments"
  | "admin"
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  roles: readonly Role[];
}

const EVERYONE: readonly Role[] = ["CEO", "MANAGER", "TEAM_LEAD", "DEVELOPER"];
const LEADS_AND_UP: readonly Role[] = ["CEO", "MANAGER", "TEAM_LEAD"];

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", roles: EVERYONE },
  { href: "/tasks", label: "Tasks", icon: "tasks", roles: EVERYONE },
  { href: "/projects", label: "Projects", icon: "projects", roles: EVERYONE },
  { href: "/team", label: "Team", icon: "team", roles: LEADS_AND_UP },
  { href: "/reviews", label: "Reviews", icon: "reviews", roles: LEADS_AND_UP },
  { href: "/departments", label: "Departments", icon: "departments", roles: ["CEO"] },
  { href: "/admin", label: "Admin", icon: "admin", roles: ["CEO"] },
  { href: "/settings", label: "Settings", icon: "settings", roles: EVERYONE },
];

export const navItemsFor = (role: Role) => NAV_ITEMS.filter((item) => item.roles.includes(role));
