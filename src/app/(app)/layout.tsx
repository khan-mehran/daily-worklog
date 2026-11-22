import type { ReactNode } from "react";
import { AppShell, type ShellDepartment } from "@/components/layout/app-shell";
import { SyncSetupPopup } from "@/components/settings/sync-setup-popup";
import { getPageScope } from "@/lib/auth/page";
import { seesAllDepartments } from "@/lib/constants";
import { countUnreadNotifications } from "@/lib/notifications";
import { prisma } from "@/lib/db/prisma";

const toShell = (department: {
  id: string;
  name: string;
  code: string;
  color: string;
}): ShellDepartment => ({
  id: department.id,
  name: department.name,
  code: department.code,
  color: department.color,
});

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, selectedDepartmentId } = await getPageScope();

  const [ownDepartment, departments, unreadCount] = await Promise.all([
    user.departmentId ? prisma.department.findUnique({ where: { id: user.departmentId } }) : null,
    seesAllDepartments(user.role)
      ? prisma.department.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    countUnreadNotifications(user.id),
  ]);

  // The setup popup is for people who log tasks, haven't been shown it and have no sync token yet.
  const showSyncSetup =
    !seesAllDepartments(user.role) &&
    (await prisma.user.count({ where: { id: user.id, syncGuideSeenAt: null, apiTokens: { none: {} } } })) > 0;

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        avatarColor: user.avatarColor,
        theme: user.preferences.theme,
      }}
      department={ownDepartment ? toShell(ownDepartment) : null}
      departments={departments.map(toShell)}
      selectedDepartmentId={selectedDepartmentId}
      unreadCount={unreadCount}
    >
      {children}
      <SyncSetupPopup show={showSyncSetup} />
    </AppShell>
  );
}
