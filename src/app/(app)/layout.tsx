import type { ReactNode } from "react";
import { AppShell, type ShellDepartment } from "@/components/layout/app-shell";
import { getPageScope } from "@/lib/auth/page";
import { countUnreadNotifications } from "@/lib/notifications";
import { Department } from "@/models";

const toShell = (department: {
  _id: unknown;
  name: string;
  code: string;
  color: string;
}): ShellDepartment => ({
  id: String(department._id),
  name: department.name,
  code: department.code,
  color: department.color,
});

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, selectedDepartmentId } = await getPageScope();

  const [ownDepartment, departments, unreadCount] = await Promise.all([
    user.departmentId ? Department.findById(user.departmentId).lean() : null,
    user.role === "CEO"
      ? Department.find({ status: "Active" }).sort({ name: 1 }).lean()
      : Promise.resolve([]),
    countUnreadNotifications(user.id),
  ]);

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
    </AppShell>
  );
}
