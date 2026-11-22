import type { Metadata } from "next";
import { SiteSettingsView } from "@/components/site-settings/site-settings-view";
import { requirePageRole } from "@/lib/auth/page";
import { readEnvSettings } from "@/lib/site-settings/env";
import { getApprovalSettings } from "@/lib/site-settings/service";

export const metadata: Metadata = { title: "Site settings" };
// Read from the database and the environment file on every visit.
export const dynamic = "force-dynamic";

export default async function SiteSettingsPage() {
  await requirePageRole("SUPER_ADMIN");
  const [approval, env] = await Promise.all([getApprovalSettings(), readEnvSettings()]);
  return <SiteSettingsView approval={approval} env={env} />;
}
