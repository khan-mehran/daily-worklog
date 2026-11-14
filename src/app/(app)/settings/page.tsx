import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/settings-view";
import { requirePageUser } from "@/lib/auth/page";
import { Department } from "@/models";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requirePageUser();
  const department = user.departmentId
    ? await Department.findById(user.departmentId).select("name").lean()
    : null;
  return (
    <SettingsView
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        department: department?.name ?? null,
        preferences: user.preferences,
      }}
    />
  );
}
