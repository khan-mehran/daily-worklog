import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectDetailView } from "@/components/projects/project-detail-view";
import { requirePageUser } from "@/lib/auth/page";
import { canManageProjects } from "@/lib/permissions";
import { getProjectDetail, projectDepartmentOf } from "@/lib/projects/service";
import { isId } from "@/validators/common";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  if (!isId(id)) notFound();
  const project = await getProjectDetail(user, id);
  if (!project) notFound();
  const canManage = canManageProjects(user) || (await projectDepartmentOf(user)) === project.department.id;
  return <ProjectDetailView project={project} role={user.role} canManage={canManage} />;
}
