import type { Metadata } from "next";
import { Suspense } from "react";
import { TeamView } from "@/components/team/team-view";
import { requirePageRole } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const user = await requirePageRole("SUPER_ADMIN", "CEO", "MANAGER", "TEAM_LEAD");
  return (
    <Suspense>
      <TeamView role={user.role} />
    </Suspense>
  );
}
