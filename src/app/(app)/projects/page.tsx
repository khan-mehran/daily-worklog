import type { Metadata } from "next";
import { ProjectsView } from "@/components/projects/projects-view";
import { requirePageUser } from "@/lib/auth/page";
import { canManageProjects } from "@/lib/permissions";
import { projectDepartmentOf } from "@/lib/projects/service";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const user = await requirePageUser();
  const departmentId = await projectDepartmentOf(user);
  return (
    <ProjectsView
      role={user.role}
      canManage={canManageProjects(user) || Boolean(departmentId)}
      departmentId={departmentId}
    />
  );
}
