import type { Prisma, ProjectAudit } from "@prisma/client";
import { AUDIT_SEVERITIES, type AuditStatus, type PaletteColor, type ProjectStatus } from "@/lib/constants";
import { prisma } from "@/lib/db/prisma";
import { notify } from "@/lib/notifications";
import { projectScope, type Actor } from "@/lib/permissions";
import { auditPackages, type AuditCounts, type AuditFinding } from "./advisories";
import { bitbucketConfigured, fetchLockfile } from "./bitbucket";
import { AuditError } from "./errors";
import { installedPackages } from "./lockfile";

// The dependency audit. Every project with a Bitbucket repository is checked once a day against
// npm's advisory database, whether or not anyone is working on it: a project nobody has touched
// for months becomes vulnerable the day an advisory is published for something it installs.

const HOUR = 60 * 60 * 1000;
/** Under a day, so a job that runs at the same time every day never skips one. */
const RECHECK_AFTER = 20 * HOUR;
/** A check that failed is tried again on the next hourly run. */
const RETRY_AFTER = 50 * 60 * 1000;
const PROJECTS_PER_RUN = 200;

const NO_COUNTS: AuditCounts = { critical: 0, high: 0, moderate: 0, low: 0 };

const total = (counts: AuditCounts) => AUDIT_SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0);

/** "1 critical, 2 high" */
const countsText = (counts: AuditCounts) =>
  AUDIT_SEVERITIES.filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(", ");

interface AuditedProject {
  id: string;
  name: string;
  departmentId: string;
  ownerId: string;
  repository: string | null;
}

/** Tells the project's owner and the department's manager, in the app and by email. */
async function alertVulnerable(project: AuditedProject, counts: AuditCounts) {
  const department = await prisma.department.findUnique({
    where: { id: project.departmentId },
    select: { managerId: true },
  });
  const packages = total(counts);
  for (const recipientId of new Set([project.ownerId, department?.managerId].filter((id): id is string => Boolean(id)))) {
    await notify({
      recipientId,
      departmentId: project.departmentId,
      type: "SECURITY_ALERT",
      title: `${project.name} has vulnerable dependencies`,
      message: `The daily dependency check found ${packages} vulnerable package${packages === 1 ? "" : "s"} in ${project.name} (${countsText(counts)}). Run npm audit in the project to see how to fix them.`,
      link: `/projects/${project.id}`,
      email: true,
    });
  }
}

/**
 * Checks one project now and stores the result. A check that fails keeps the last result that
 * worked and records why, so a night without Bitbucket doesn't turn a vulnerable project blank.
 */
export async function auditProject(project: AuditedProject, now = new Date()) {
  if (!project.repository) return null;
  const previous = await prisma.projectAudit.findUnique({ where: { projectId: project.id } });
  try {
    const lockfile = await fetchLockfile(project.repository);
    const result = lockfile === null ? { counts: NO_COUNTS, findings: [] } : await auditPackages(installedPackages(lockfile));
    const status: AuditStatus = lockfile === null ? "NO_LOCKFILE" : total(result.counts) > 0 ? "VULNERABLE" : "CLEAR";
    const data = {
      status,
      ...result.counts,
      findings: result.findings as unknown as Prisma.InputJsonValue,
      checkedAt: now,
      attemptedAt: now,
      error: null,
    };
    const saved = await prisma.projectAudit.upsert({
      where: { projectId: project.id },
      create: { projectId: project.id, ...data },
      update: data,
    });
    // Once when a project becomes vulnerable and again whenever it gets worse, not every day.
    const before = previous?.status === "VULNERABLE" ? total(previous) : 0;
    if (status === "VULNERABLE" && total(result.counts) > before) await alertVulnerable(project, result.counts);
    return saved;
  } catch (error) {
    if (!(error instanceof AuditError)) console.error("[audit] check failed", project.id, error);
    const message = error instanceof AuditError ? error.message : "The check failed unexpectedly.";
    return prisma.projectAudit.upsert({
      where: { projectId: project.id },
      create: { projectId: project.id, status: "UNKNOWN", attemptedAt: now, error: message },
      update: { attemptedAt: now, error: message },
    });
  }
}

/**
 * Checks every project that is due: never checked, last checked most of a day ago, or failed on
 * the last run. Safe to call as often as you like. Called by /api/cron/audit.
 */
export async function runDueAudits(now = new Date(), { force = false } = {}) {
  if (!bitbucketConfigured()) return { configured: false, checked: 0, vulnerable: 0, failed: 0 };
  const due: Prisma.ProjectWhereInput = force
    ? {}
    : {
        OR: [
          { audit: { is: null } },
          { audit: { is: { attemptedAt: { lt: new Date(now.getTime() - RECHECK_AFTER) } } } },
          { audit: { is: { error: { not: null }, attemptedAt: { lt: new Date(now.getTime() - RETRY_AFTER) } } } },
        ],
      };
  const projects = await prisma.project.findMany({
    where: { repository: { not: null }, ...due },
    select: { id: true, name: true, departmentId: true, ownerId: true, repository: true },
    orderBy: { createdAt: "asc" },
    take: PROJECTS_PER_RUN,
  });
  let vulnerable = 0;
  let failed = 0;
  // One at a time: a handful of requests per project, and no burst against Bitbucket's limits.
  for (const project of projects) {
    const audit = await auditProject(project, now);
    if (audit?.error) failed += 1;
    else if (audit?.status === "VULNERABLE") vulnerable += 1;
  }
  return { configured: true, checked: projects.length, vulnerable, failed };
}

type AuditRecord = Pick<ProjectAudit, "status" | "critical" | "high" | "moderate" | "low" | "checkedAt" | "error">;

function summarise(audit: AuditRecord | null) {
  return {
    status: (audit?.status ?? "UNKNOWN") as AuditStatus,
    counts: audit ? { critical: audit.critical, high: audit.high, moderate: audit.moderate, low: audit.low } : NO_COUNTS,
    checkedAt: audit?.checkedAt?.toISOString() ?? null,
    error: audit?.error ?? null,
  };
}

/** A project's audit for its own page, with the vulnerable packages. Null without a repository. */
export function serialiseAudit(repository: string | null, audit: ProjectAudit | null) {
  if (!repository) return null;
  return { ...summarise(audit), findings: (audit?.findings ?? []) as unknown as AuditFinding[] };
}

const STATUS_ORDER: Record<AuditStatus, number> = { VULNERABLE: 0, UNKNOWN: 1, NO_LOCKFILE: 2, CLEAR: 3 };

/** The dashboard card: every project the actor can see that has a repository, worst first. */
export async function auditOverview(actor: Actor, selectedDepartmentId: string | null) {
  const scope = projectScope(actor, selectedDepartmentId);
  const [projects, unlinked] = await Promise.all([
    prisma.project.findMany({
      where: { ...scope, repository: { not: null } },
      select: { id: true, name: true, color: true, audit: true },
      orderBy: { name: "asc" },
    }),
    // A finished project with no repository isn't something left to do.
    prisma.project.count({ where: { ...scope, repository: null, status: { not: "Completed" } } }),
  ]);
  const rows = projects.map((project) => ({
    id: project.id,
    name: project.name,
    color: project.color as PaletteColor,
    ...summarise(project.audit),
  }));
  const weight = (row: (typeof rows)[number]) =>
    AUDIT_SEVERITIES.reduce((sum, severity) => sum * 1000 + Math.min(row.counts[severity], 999), 0);
  rows.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      weight(b) - weight(a) ||
      Number(Boolean(b.error)) - Number(Boolean(a.error)) ||
      a.name.localeCompare(b.name),
  );
  return { configured: bitbucketConfigured(), unlinked, projects: rows };
}

/**
 * The Dependency audit page: every project the actor can see, worst first, each with its
 * vulnerable packages. Projects without a repository are listed too, so it shows what isn't checked.
 */
export async function auditReport(actor: Actor, selectedDepartmentId: string | null) {
  const projects = await prisma.project.findMany({
    where: projectScope(actor, selectedDepartmentId),
    select: {
      id: true,
      name: true,
      code: true,
      color: true,
      status: true,
      repository: true,
      audit: true,
      department: { select: { name: true, color: true } },
    },
    orderBy: { name: "asc" },
  });
  const rows = projects.map((project) => ({
    id: project.id,
    name: project.name,
    code: project.code,
    color: project.color as PaletteColor,
    projectStatus: project.status as ProjectStatus,
    repository: project.repository,
    department: { name: project.department.name, color: project.department.color as PaletteColor },
    ...summarise(project.repository ? project.audit : null),
    findings: (project.repository ? (project.audit?.findings ?? []) : []) as unknown as AuditFinding[],
  }));
  const weight = (row: (typeof rows)[number]) =>
    AUDIT_SEVERITIES.reduce((sum, severity) => sum * 1000 + Math.min(row.counts[severity], 999), 0);
  rows.sort(
    (a, b) =>
      Number(Boolean(b.repository)) - Number(Boolean(a.repository)) ||
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      weight(b) - weight(a) ||
      Number(Boolean(b.error)) - Number(Boolean(a.error)) ||
      a.name.localeCompare(b.name),
  );
  return { configured: bitbucketConfigured(), projects: rows };
}

export type AuditReport = Awaited<ReturnType<typeof auditReport>>;
export type AuditOverview = Awaited<ReturnType<typeof auditOverview>>;
export type ProjectAuditDetail = NonNullable<ReturnType<typeof serialiseAudit>>;
