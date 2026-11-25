import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/settings-view";
import { requirePageUser } from "@/lib/auth/page";
import { getBitbucketConnection } from "@/lib/bitbucket/connection";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requirePageUser();
  const department = user.departmentId
    ? await prisma.department.findUnique({ where: { id: user.departmentId }, select: { name: true } })
    : null;
  return (
    <SettingsView
      bitbucket={await getBitbucketConnection(user)}
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
