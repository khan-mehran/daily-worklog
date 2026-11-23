import type { Metadata } from "next";
import { AuditsView } from "@/components/audit/audits-view";
import { getPageScope } from "@/lib/auth/page";
import { auditReport } from "@/lib/audit/service";
import { seesAllDepartments } from "@/lib/constants";

export const metadata: Metadata = { title: "Dependency audit" };

export default async function AuditsPage() {
  const { user, selectedDepartmentId } = await getPageScope();
  const report = await auditReport(user, selectedDepartmentId);
  return <AuditsView report={report} showDepartment={seesAllDepartments(user.role) && !selectedDepartmentId} />;
}
