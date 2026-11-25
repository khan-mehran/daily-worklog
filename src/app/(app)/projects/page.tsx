import type { Metadata } from "next";
import { ProjectsView } from "@/components/projects/projects-view";
import { requirePageUser } from "@/lib/auth/page";
import { bitbucketDepartmentOf } from "@/lib/bitbucket/connection";
import { canManageProjects } from "@/lib/permissions";
import { projectDepartmentOf } from "@/lib/projects/service";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const user = await requirePageUser();
  const departmentId = await projectDepartmentOf(user);
  return (
    <ProjectsView
      canImport={Boolean(await bitbucketDepartmentOf(user))}
      role={user.role}
      canManage={canManageProjects(user) || Boolean(departmentId)}
      departmentId={departmentId}
    />
  );
}
