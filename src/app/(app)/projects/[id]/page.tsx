import type { Metadata } from "next";
import { Types } from "mongoose";
import { notFound } from "next/navigation";
import { ProjectDetailView } from "@/components/projects/project-detail-view";
import { requirePageUser } from "@/lib/auth/page";
import { canManageProjects } from "@/lib/permissions";
import { getProjectDetail } from "@/lib/projects/service";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) notFound();
  const project = await getProjectDetail(user, new Types.ObjectId(id));
  if (!project) notFound();
  return <ProjectDetailView project={project} role={user.role} canManage={canManageProjects(user)} />;
}
