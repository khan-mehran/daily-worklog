import type { Metadata } from "next";
import { Types } from "mongoose";
import { notFound } from "next/navigation";
import { DepartmentDetailView } from "@/components/departments/department-detail-view";
import { requirePageRole } from "@/lib/auth/page";
import { getDepartmentDetail } from "@/lib/departments/service";

export const metadata: Metadata = { title: "Department" };

export default async function DepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageRole("CEO");
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) notFound();
  const detail = await getDepartmentDetail(new Types.ObjectId(id));
  if (!detail) notFound();
  return <DepartmentDetailView department={detail} />;
}
