import type { Metadata } from "next";
import { AdminView } from "@/components/admin/admin-view";
import { requirePageRole } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  await requirePageRole("CEO");
  return <AdminView />;
}
