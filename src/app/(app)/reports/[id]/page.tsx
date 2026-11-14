import type { Metadata } from "next";
import { Types } from "mongoose";
import { notFound } from "next/navigation";
import { ReportDetailView } from "@/components/reports/report-detail-view";
import { requirePageUser } from "@/lib/auth/page";
import { getReportDetail } from "@/lib/reports/service";

export const metadata: Metadata = { title: "Weekly report" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) notFound();
  // Reports past the viewer's approval gate are a 404, as in the API.
  const report = await getReportDetail(user, new Types.ObjectId(id));
  if (!report) notFound();
  return <ReportDetailView report={report} />;
}
