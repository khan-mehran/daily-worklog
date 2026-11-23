import { satisfies } from "semver";
import { AUDIT_SEVERITIES, type AuditSeverity } from "@/lib/constants";
import { AuditError } from "./errors";
import type { InstalledPackages } from "./lockfile";

// The npm registry's advisory database: the one `npm audit` asks. Only package names and versions
// are sent, which is what a lockfile already tells the registry on every install.
const ADVISORIES_URL = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const PACKAGES_PER_REQUEST = 500;
const MAX_FINDINGS = 50;
const TIMEOUT_MS = 30_000;

interface Advisory {
  url?: string;
  title?: string;
  severity?: string;
  vulnerable_versions?: string;
}

/** One vulnerable package, with its worst advisory. */
export interface AuditFinding {
  name: string;
  versions: string[];
  severity: AuditSeverity;
  title: string;
  url: string | null;
  advisories: number;
}

export type AuditCounts = Record<AuditSeverity, number>;

export interface AuditResult {
  counts: AuditCounts;
  /** Worst first, and at most MAX_FINDINGS. The counts cover every vulnerable package. */
  findings: AuditFinding[];
}

// The registry also has "info". Nothing separates it from "low" for someone deciding what to fix.
const severityOf = (value: string | undefined): AuditSeverity =>
  (AUDIT_SEVERITIES as readonly string[]).includes(value ?? "") ? (value as AuditSeverity) : "low";

const rank = (severity: AuditSeverity) => AUDIT_SEVERITIES.indexOf(severity);

function affects(advisory: Advisory, version: string) {
  try {
    // The options npm itself uses, so a pre-release of a vulnerable version counts.
    return satisfies(version, advisory.vulnerable_versions ?? "*", { loose: true, includePrerelease: true });
  } catch {
    return false;
  }
}

async function fetchAdvisories(body: Record<string, string[]>): Promise<Record<string, Advisory[]>> {
  let response: Response;
  try {
    response = await fetch(ADVISORIES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AuditError("The npm advisory database couldn't be reached.");
  }
  if (!response.ok) throw new AuditError(`The npm advisory database answered ${response.status}.`);
  return (await response.json()) as Record<string, Advisory[]>;
}

/**
 * Counts the vulnerable packages by their worst severity, as the summary line of `npm audit`
 * does. `npm audit` also counts every package that depends on a vulnerable one, so its totals can
 * be higher. A project is clear here exactly when it is clear there.
 */
export async function auditPackages(installed: InstalledPackages): Promise<AuditResult> {
  const names = [...installed.keys()];
  const advisories: Record<string, Advisory[]> = {};
  for (let start = 0; start < names.length; start += PACKAGES_PER_REQUEST) {
    const chunk = names.slice(start, start + PACKAGES_PER_REQUEST);
    Object.assign(advisories, await fetchAdvisories(Object.fromEntries(chunk.map((name) => [name, [...installed.get(name)!]]))));
  }

  const counts: AuditCounts = { critical: 0, high: 0, moderate: 0, low: 0 };
  const findings: AuditFinding[] = [];
  for (const [name, list] of Object.entries(advisories)) {
    const versions = [...(installed.get(name) ?? [])];
    // The registry answers for the package, so each advisory is matched to the installed versions.
    const matching = (Array.isArray(list) ? list : []).filter((advisory) => versions.some((version) => affects(advisory, version)));
    if (matching.length === 0) continue;
    const worst = matching.reduce((a, b) => (rank(severityOf(b.severity)) < rank(severityOf(a.severity)) ? b : a));
    const severity = severityOf(worst.severity);
    counts[severity] += 1;
    findings.push({
      name,
      versions: versions.filter((version) => matching.some((advisory) => affects(advisory, version))),
      severity,
      title: worst.title ?? "Security advisory",
      url: worst.url ?? null,
      advisories: matching.length,
    });
  }
  findings.sort((a, b) => rank(a.severity) - rank(b.severity) || a.name.localeCompare(b.name));
  return { counts, findings: findings.slice(0, MAX_FINDINGS) };
}
