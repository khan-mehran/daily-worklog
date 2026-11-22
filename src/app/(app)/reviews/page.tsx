import type { Metadata } from "next";
import { ReviewsView } from "@/components/reports/reviews-view";
import { requirePageRole } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage() {
  await requirePageRole("SUPER_ADMIN", "CEO", "MANAGER", "TEAM_LEAD");
  return <ReviewsView />;
}
