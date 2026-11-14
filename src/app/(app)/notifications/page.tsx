import type { Metadata } from "next";
import { NotificationsView } from "@/components/notifications/notifications-view";
import { requirePageUser } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requirePageUser();
  return <NotificationsView />;
}
