import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DepartmentDetailView } from "@/components/departments/department-detail-view";
import { requirePageRole } from "@/lib/auth/page";
import { getDepartmentDetail } from "@/lib/departments/service";
import { isId } from "@/validators/common";

export const metadata: Metadata = { title: "Department" };

export default async function DepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageRole("SUPER_ADMIN", "CEO");
  const { id } = await params;
  if (!isId(id)) notFound();
  const detail = await getDepartmentDetail(id);
  if (!detail) notFound();
  return <DepartmentDetailView department={detail} />;
}
