import { NextResponse } from "next/server";
import { forbidden } from "@/lib/api/errors";
import { authedRoute, parseBody } from "@/lib/api/handler";
import { isSuperAdmin } from "@/lib/permissions";
import { readEnvSettings, saveEnvSettings } from "@/lib/site-settings/env";
import { envPatchSchema } from "@/validators/site-settings";

// The environment file. Secret values are write-only: a GET says only whether each one is set.
export const GET = authedRoute(async ({ user }) => {
  if (!isSuperAdmin(user)) throw forbidden();
  return NextResponse.json({ data: await readEnvSettings() });
});

export const PATCH = authedRoute(async ({ req, user }) => {
  if (!isSuperAdmin(user)) throw forbidden();
  const { values } = await parseBody(req, envPatchSchema);
  const { restart } = await saveEnvSettings(user, values);
  return NextResponse.json({ data: { settings: await readEnvSettings(), restart } });
});
