import type { Metadata } from "next";
import { DepartmentsView } from "@/components/departments/departments-view";
import { requirePageRole } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  await requirePageRole("CEO");
  return <DepartmentsView />;
}
