import type { Metadata } from "next";
import {
  CeoDashboard,
  DeveloperDashboard,
  LeadDashboard,
  ManagerDashboard,
} from "@/components/dashboard/role-dashboards";
import { PageHeader } from "@/components/ui/misc";
import { getPageScope } from "@/lib/auth/page";
import { ROLE_LABELS, seesAllDepartments } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { user, selectedDepartmentId } = await getPageScope();
  const departmentId = selectedDepartmentId ?? user.departmentId;
  const department = departmentId
    ? await prisma.department.findUnique({ where: { id: departmentId }, select: { name: true } })
    : null;
  const where = department ? department.name : seesAllDepartments(user.role) ? "All departments" : null;

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.name.split(" ")[0]}`}
        description={`${ROLE_LABELS[user.role]}${where ? ` · ${where}` : ""}. Numbers follow the date range in the top bar.`}
      />
      {seesAllDepartments(user.role) ? (
        <CeoDashboard />
      ) : user.role === "MANAGER" ? (
        <ManagerDashboard />
      ) : user.role === "TEAM_LEAD" ? (
        <LeadDashboard />
      ) : (
        <DeveloperDashboard />
      )}
    </>
  );
}
