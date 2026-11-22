import type { Metadata } from "next";
import { Suspense } from "react";
import { UsersView } from "@/components/users/users-view";
import { requirePageRole } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const user = await requirePageRole("SUPER_ADMIN", "CEO");
  return (
    <Suspense>
      <UsersView viewer={{ id: user.id, role: user.role }} />
    </Suspense>
  );
}
