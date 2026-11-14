"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Building2,
  ClipboardCheck,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  FolderKanban,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, ColorDot } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { ROLE_LABELS, type Role, type ThemePreference } from "@/lib/constants";
import { navItemsFor, type NavIcon, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./command-palette";
import { DateRangePicker, DateRangeProvider } from "./date-range";
import { NotificationBell } from "./notification-bell";

export interface ShellDepartment {
  id: string;
  name: string;
  code: string;
  color: string;
}

export interface ShellProps {
  user: { name: string; email: string; role: Role; avatarColor: string; theme: ThemePreference };
  /** The user's own department. Null for the CEO and unassigned managers. */
  department: ShellDepartment | null;
  /** Switcher options. Only ever non-empty for the CEO. */
  departments: ShellDepartment[];
  selectedDepartmentId: string | null;
  unreadCount: number;
  children: ReactNode;
}

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  tasks: ListChecks,
  projects: FolderKanban,
  team: Users,
  reviews: ClipboardCheck,
  departments: Building2,
  admin: ShieldCheck,
  settings: Settings,
};

const SIDEBAR_KEY = "worklog-sidebar-collapsed";
const ITEM_MENU_CLASS =
  "data-[highlighted]:bg-subtle flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none";

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Sidebar({
  items,
  pathname,
  user,
  department,
}: { items: NavItem[]; pathname: string } & Pick<ShellProps, "user" | "department">) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      // Blocked storage just means the expanded default.
    }
  }, []);

  function toggle() {
    setCollapsed((current) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, current ? "0" : "1");
      } catch {
        // The sidebar still toggles for this visit.
      }
      return !current;
    });
  }

  return (
    <aside
      className={cn(
        "bg-sidebar text-sidebar-foreground sticky top-0 hidden h-dvh shrink-0 flex-col transition-[width] duration-200 md:flex",
        collapsed ? "w-[72px]" : "w-64",
      )}
    >
      <div
        className={cn(
          "bg-sidebar-deep flex h-16 shrink-0 items-center gap-3 px-5",
          collapsed && "justify-center px-0",
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white ring-1 ring-white/15">
          <NotebookPen className="size-5" aria-hidden />
        </span>
        {collapsed ? null : (
          <span className="text-lg font-semibold tracking-tight text-white">WorkLog</span>
        )}
      </div>
      <div
        className={cn(
          "border-sidebar-border flex shrink-0 items-center gap-3 border-b px-5 py-5",
          collapsed && "justify-center px-0",
        )}
      >
        <Avatar
          name={user.name}
          color={user.avatarColor}
          className={cn("bg-white/10 text-white", !collapsed && "size-11 text-sm")}
        />
        {collapsed ? null : (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-white">{user.name}</p>
            <p className="text-sidebar-heading mt-0.5 truncate text-xs">
              {ROLE_LABELS[user.role]}
              {department ? ` · ${department.name}` : ""}
            </p>
          </div>
        )}
      </div>
      <nav aria-label="Main" className="flex-1 overflow-x-hidden overflow-y-auto py-3">
        {collapsed ? null : (
          <p className="text-sidebar-heading px-5 pt-2 pb-2 text-[11px] font-semibold tracking-wider uppercase">
            Navigation
          </p>
        )}
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                "relative flex h-11 items-center gap-3 px-5 text-sm font-medium transition-colors duration-150",
                collapsed && "justify-center px-0",
                active
                  ? "bg-sidebar-selected text-white"
                  : "hover:bg-sidebar-hover hover:text-white",
              )}
            >
              {active ? (
                <span aria-hidden className="bg-sidebar-indicator absolute inset-y-0 left-0 w-[3px]" />
              ) : null}
              <Icon className="size-[18px] shrink-0" aria-hidden />
              {collapsed ? null : item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-sidebar-border border-t p-3">
        <Button
          variant="ghost"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "text-sidebar-foreground hover:bg-sidebar-hover w-full font-medium hover:text-white",
            collapsed ? "justify-center px-0" : "justify-start",
          )}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          {collapsed ? null : "Collapse"}
        </Button>
      </div>
    </aside>
  );
}

/** Bottom bar for phones: the first four destinations, and the rest under More. */
function MobileNav({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const primary = items.slice(0, 4);
  const overflow = items.slice(4);
  const itemClass =
    "flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";

  return (
    <nav
      aria-label="Main"
      className="bg-surface fixed inset-x-0 bottom-0 z-40 flex h-16 border-t md:hidden"
    >
      {primary.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(itemClass, active ? "text-primary" : "text-muted")}
          >
            <Icon className="size-5" aria-hidden />
            {item.label}
          </Link>
        );
      })}
      {overflow.length > 0 ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className={cn(itemClass, "text-muted")}>
            <MoreHorizontal className="size-5" aria-hidden />
            More
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="end"
              sideOffset={8}
              className="bg-surface z-50 min-w-44 rounded-lg border p-1"
            >
              {overflow.map((item) => {
                const Icon = ICONS[item.icon];
                return (
                  <DropdownMenu.Item key={item.href} asChild className={ITEM_MENU_CLASS}>
                    <Link href={item.href}>
                      <Icon className="size-4" aria-hidden />
                      {item.label}
                    </Link>
                  </DropdownMenu.Item>
                );
              })}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : null}
    </nav>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function ThemeToggle({ preference }: { preference: ThemePreference }) {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Apply the saved preference once, so it follows the user between browsers.
  useEffect(() => {
    setTheme(preference);
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(theme: ThemePreference) {
    setTheme(theme);
    api("/api/me/preferences", { method: "PATCH", body: { theme } }).catch(() => {
      toast.error("Couldn't save your theme. It will apply on this device only.");
    });
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          {mounted && resolvedTheme === "dark" ? <Moon /> : <Sun />}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="bg-surface z-50 min-w-36 rounded-lg border p-1"
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenu.Item
              key={value}
              onSelect={() => choose(value)}
              className={ITEM_MENU_CLASS}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function DepartmentSwitcher({
  departments,
  selectedDepartmentId,
}: {
  departments: ShellDepartment[];
  selectedDepartmentId: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(selectedDepartmentId ?? "all");

  async function change(next: string) {
    const previous = value;
    setValue(next);
    try {
      await api("/api/me/department-filter", {
        method: "PUT",
        body: { departmentId: next === "all" ? null : next },
      });
      await queryClient.invalidateQueries();
      router.refresh();
    } catch (error) {
      setValue(previous);
      toast.error((error as Error).message);
    }
  }

  return (
    <Select
      aria-label="Department filter"
      value={value}
      onValueChange={change}
      className="max-w-48"
      options={[
        { value: "all", label: "All departments" },
        ...departments.map((department) => ({
          value: department.id,
          label: department.name,
          icon: <ColorDot color={department.color} />,
        })),
      ]}
    />
  );
}

function UserMenu({ user, department }: Pick<ShellProps, "user" | "department">) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Account menu for ${user.name}`}
        className="flex items-center gap-2 rounded-full"
      >
        <Avatar name={user.name} color={user.avatarColor} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="bg-surface z-50 min-w-56 rounded-lg border p-1"
        >
          <div className="border-b px-2 pt-1.5 pb-2.5">
            <p className="text-sm font-semibold">{user.name}</p>
            <p className="text-muted text-xs">{user.email}</p>
            <p className="text-muted mt-1 text-xs">
              {ROLE_LABELS[user.role]}
              {department ? ` · ${department.name}` : ""}
            </p>
          </div>
          <DropdownMenu.Item asChild className={cn(ITEM_MENU_CLASS, "mt-1")}>
            <Link href="/settings">
              <Settings className="size-4" aria-hidden />
              Settings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => signOut({ callbackUrl: "/login" })}
            className={ITEM_MENU_CLASS}
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function AppShell({
  user,
  department,
  departments,
  selectedDepartmentId,
  unreadCount,
  children,
}: ShellProps) {
  const pathname = usePathname();
  const items = navItemsFor(user.role);

  return (
    <DateRangeProvider>
      <div className="flex min-h-dvh">
        <Sidebar items={items} pathname={pathname} user={user} department={department} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-surface sticky top-0 z-30 flex h-16 items-center gap-2 px-4 shadow-[0_2px_10px_rgb(60_40_110/0.08)] md:px-6">
            <span className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-lg md:hidden">
              <NotebookPen className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              {user.role === "CEO" ? (
                <DepartmentSwitcher
                  departments={departments}
                  selectedDepartmentId={selectedDepartmentId}
                />
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  <span className="hidden truncate text-sm font-semibold sm:inline">{user.name}</span>
                  {department ? (
                    <Badge>
                      <ColorDot color={department.color} />
                      {department.name}
                    </Badge>
                  ) : (
                    <Badge className="text-muted">No department</Badge>
                  )}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              aria-label="Search (Ctrl+K)"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() =>
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))
              }
              className="text-muted w-10 px-0 font-normal lg:bg-background lg:hover:bg-subtle lg:w-64 lg:justify-start lg:px-3"
            >
              <Search />
              <span className="hidden lg:inline">Search for anything</span>
            </Button>
            <DateRangePicker />
            <ThemeToggle preference={user.theme} />
            <NotificationBell initialUnread={unreadCount} />
            <UserMenu user={user} department={department} />
          </header>
          <main className="flex-1 px-4 py-6 pb-24 md:px-6 md:pb-8">{children}</main>
          <CommandPalette role={user.role} />
        </div>
        <MobileNav items={items} pathname={pathname} />
      </div>
    </DateRangeProvider>
  );
}
