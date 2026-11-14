import type { Metadata } from "next";
import { ProjectsView } from "@/components/projects/projects-view";
import { requirePageUser } from "@/lib/auth/page";
import { canManageProjects } from "@/lib/permissions";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const user = await requirePageUser();
  return <ProjectsView role={user.role} canManage={canManageProjects(user)} />;
}
