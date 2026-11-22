import { prisma } from "@/lib/db/prisma";
import { notify } from "@/lib/notifications";
import type { Actor } from "@/lib/permissions";

// Organisation-wide switches, stored one row per group in SiteSetting. Only a Super Admin changes
// them, on the Site settings page.

/** Which roles take part in approving weekly reports. The final approval can't be turned off. */
export interface ApprovalSettings {
  /**
   * When false, Team Leads are exempt from reviewing: a Developer's report goes straight to
   * their department's Manager (the Super Admin for the IT department), whose approval is final.
   */
  teamLeadReview: boolean;
}

const APPROVAL_KEY = "approval";
export const DEFAULT_APPROVAL: ApprovalSettings = { teamLeadReview: true };

export async function getApprovalSettings(): Promise<ApprovalSettings> {
  const row = await prisma.siteSetting.findUnique({ where: { key: APPROVAL_KEY } });
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_APPROVAL;
  return { teamLeadReview: value.teamLeadReview !== false };
}

/**
 * Saves the approval chain. Turning the Team Lead review off also moves developers' reports that
 * are waiting for a Team Lead on to the department's Manager, and tells the Manager.
 */
export async function saveApprovalSettings(actor: Actor, settings: ApprovalSettings) {
  const before = await getApprovalSettings();
  await prisma.siteSetting.upsert({
    where: { key: APPROVAL_KEY },
    create: { key: APPROVAL_KEY, value: { ...settings } },
    update: { value: { ...settings } },
  });
  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: "site.approval",
      targetType: "SiteSettings",
      targetId: actor.id,
      meta: { before: { ...before }, after: { ...settings } },
    },
  });
  const rerouted = settings.teamLeadReview ? 0 : await passWaitingReportsToManagers();
  return { settings, rerouted };
}

async function passWaitingReportsToManagers() {
  const waiting = await prisma.weeklyReport.findMany({
    where: {
      status: "SUBMITTED",
      user: { role: "DEVELOPER" },
      department: { managerId: { not: null } },
    },
    select: {
      id: true,
      isoWeek: true,
      departmentId: true,
      currentApproverId: true,
      user: { select: { name: true } },
      department: { select: { managerId: true } },
    },
  });

  let moved = 0;
  for (const report of waiting) {
    const managerId = report.department.managerId!;
    if (report.currentApproverId === managerId) continue;
    // Conditioned on what was read, so a Team Lead approving at this moment isn't overwritten.
    const { count } = await prisma.weeklyReport.updateMany({
      where: { id: report.id, status: "SUBMITTED", currentApproverId: report.currentApproverId },
      data: { currentApproverId: managerId },
    });
    if (count === 0) continue;
    moved += 1;
    await notify({
      recipientId: managerId,
      departmentId: report.departmentId,
      reportId: report.id,
      link: `/reports/${report.id}`,
      type: "REPORT_SUBMITTED",
      title: `${report.user.name}'s week ${report.isoWeek} is ready for you`,
      message: `Team Leads no longer review reports, so ${report.user.name}'s report for week ${report.isoWeek} is waiting for your review.`,
      email: true,
    });
  }
  return moved;
}
