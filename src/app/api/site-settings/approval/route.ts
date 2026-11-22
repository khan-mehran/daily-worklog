import { NextResponse } from "next/server";
import { forbidden } from "@/lib/api/errors";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { isSuperAdmin } from "@/lib/permissions";
import { getApprovalSettings, saveApprovalSettings } from "@/lib/site-settings/service";
import { approvalSettingsSchema } from "@/validators/site-settings";

export const GET = authedRoute(async ({ user }) => {
  if (!isSuperAdmin(user)) throw forbidden();
  return NextResponse.json({ data: await getApprovalSettings() });
});

// Which roles review weekly reports. Reports waiting for an exempted role move on straight away.
export const PATCH = authedRoute(async ({ req, user }) => {
  if (!isSuperAdmin(user)) throw forbidden();
  const settings = await parseBody(req, approvalSettingsSchema);
  return NextResponse.json({ data: await saveApprovalSettings(user, settings) });
});
