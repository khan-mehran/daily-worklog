"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, ColorDot, EmptyState, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api-client";
import type { AuditOverview, ProjectAuditDetail } from "@/lib/audit/service";
import { AUDIT_SEVERITIES, type AuditSeverity, type AuditStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

const SEVERITY_CLASS: Record<AuditSeverity, string> = {
  critical: "border-danger text-danger",
  high: "border-danger text-danger",
  moderate: "text-warning-text",
  low: "text-muted",
};

type Summary = Pick<ProjectAuditDetail, "status" | "counts" | "checkedAt" | "error">;

const ago = (at: string) => formatDistanceToNow(new Date(at), { addSuffix: true });

/** "2 critical", "1 high": one badge for each severity that has any. */
function SeverityBadges({ counts }: { counts: Summary["counts"] }) {
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {AUDIT_SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => (
        <Badge key={severity} className={SEVERITY_CLASS[severity]}>
          {counts[severity]} {severity}
        </Badge>
      ))}
    </span>
  );
}

const STATUS_TEXT: Record<Exclude<AuditStatus, "VULNERABLE">, string> = {
  CLEAR: "Clear",
  NO_LOCKFILE: "No package-lock.json",
  UNKNOWN: "Not checked yet",
};

function Result({ audit }: { audit: Summary }) {
  if (audit.status === "VULNERABLE") return <SeverityBadges counts={audit.counts} />;
  if (audit.status === "UNKNOWN" && audit.error) return <Badge className="text-warning-text">Couldn&apos;t check</Badge>;
  return (
    <Badge className={audit.status === "CLEAR" ? "text-success-text" : "text-muted"}>{STATUS_TEXT[audit.status]}</Badge>
  );
}

/** When it was checked, and why the latest try failed if it did. */
function CheckedLine({ audit }: { audit: Summary }) {
  if (audit.error) {
    return (
      <span className="text-warning-text">
        {audit.checkedAt ? `Last checked ${ago(audit.checkedAt)}. The latest check failed: ` : ""}
        {audit.error}
      </span>
    );
  }
  return <>{audit.checkedAt ? `Checked ${ago(audit.checkedAt)}` : "Waiting for the next daily check"}</>;
}

function Headline({ projects }: { projects: AuditOverview["projects"] }) {
  const vulnerable = projects.filter((project) => project.status === "VULNERABLE").length;
  const clear = projects.filter((project) => project.status === "CLEAR" && !project.error).length;
  // Not known to be clear: never checked, failing now, or nothing npm can audit.
  const unsure = projects.length - vulnerable - clear;
  const [Icon, tone, text] =
    vulnerable > 0
      ? ([ShieldAlert, "text-danger", `${vulnerable} of ${projects.length} project${projects.length === 1 ? " has" : "s have"} vulnerable dependencies`] as const)
      : unsure > 0
        ? ([ShieldQuestion, "text-warning-text", `${clear} clear, ${unsure} not confirmed`] as const)
        : ([ShieldCheck, "text-success-text", projects.length === 1 ? "The project is clear" : `All ${projects.length} projects are clear`] as const);
  return (
    <p className={cn("mb-3 flex items-center gap-2 font-semibold", tone)}>
      <Icon className="size-5 shrink-0" aria-hidden />
      {text}
    </p>
  );
}

/** The dashboard card: whether every project's dependencies are clear, and which aren't. */
export function DependencyAuditCard({ className }: { className?: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "audit"],
    queryFn: () => api<AuditOverview>("/api/dashboard/audit"),
  });
  return (
    <Card className={cn("p-5", className)}>
      <h2 className="font-semibold">Dependency audit</h2>
      <p className="text-muted text-sm">Every linked project, checked against npm&apos;s advisories once a day</p>
      <div className="mt-3">
        {isLoading ? (
          <div className="space-y-2" role="status" aria-label="Loading the dependency audit">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : isError || !data ? (
          <p className="text-muted text-sm">The audit results couldn&apos;t be loaded.</p>
        ) : data.projects.length === 0 ? (
          <EmptyState
            icon={ShieldQuestion}
            title="No projects are audited yet"
            description="Add a Bitbucket repository to a project, under Edit on its page, and it's checked every day."
          />
        ) : (
          <>
            <Headline projects={data.projects} />
            {data.configured ? null : (
              <p className="text-warning-text mb-3 text-sm">
                Bitbucket isn&apos;t connected, so nothing is being checked. A Super Admin adds the token in Site settings.
              </p>
            )}
            <ul className="max-h-80 divide-y overflow-y-auto">
              {data.projects.map((project) => (
                <li key={project.id} className="py-2.5 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/projects/${project.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                      <ColorDot color={project.color} />
                      <span className="truncate">{project.name}</span>
                    </Link>
                    <Result audit={project} />
                  </div>
                  <p className="text-muted mt-0.5 pl-[1.125rem] text-xs">
                    <CheckedLine audit={project} />
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
        {data && data.unlinked > 0 && data.projects.length > 0 ? (
          <p className="text-muted mt-3 text-xs">
            {data.unlinked} other project{data.unlinked === 1 ? " has" : "s have"} no repository linked, so{" "}
            {data.unlinked === 1 ? "it isn't" : "they aren't"} checked.{" "}
            <Link href="/projects" className="text-primary font-medium underline">
              See projects
            </Link>
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** The project page's card: the result, the vulnerable packages, and a button to check now. */
export function ProjectAuditCard({
  projectId,
  repository,
  audit,
  canManage,
  className,
}: {
  projectId: string;
  repository: string;
  audit: ProjectAuditDetail;
  canManage: boolean;
  className?: string;
}) {
  const router = useRouter();
  const check = useMutation({
    mutationFn: () => api<ProjectAuditDetail>(`/api/projects/${projectId}/audit`, { method: "POST" }),
    onSuccess: (result) => {
      if (result.error) toast.error(result.error);
      else toast.success("Dependencies checked.");
      // The page is rendered by the server.
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Dependency audit</h2>
          <p className="text-muted text-sm">
            {repository} on Bitbucket · <CheckedLine audit={audit} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Result audit={audit} />
          {canManage ? (
            <Button variant="secondary" size="sm" disabled={check.isPending} onClick={() => check.mutate()}>
              <RefreshCw className={check.isPending ? "animate-spin" : undefined} />
              {check.isPending ? "Checking…" : "Check now"}
            </Button>
          ) : null}
        </div>
      </div>
      {audit.findings.length > 0 ? (
        <ul className="mt-3 max-h-80 divide-y overflow-y-auto">
          {audit.findings.map((finding) => (
            <li key={finding.name} className="flex items-start gap-3 py-2.5 text-sm">
              <Badge className={cn("mt-0.5", SEVERITY_CLASS[finding.severity])}>{finding.severity}</Badge>
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">
                  {finding.name} <span className="text-muted font-normal">{finding.versions.join(", ")}</span>
                </p>
                <p className="text-muted text-xs">
                  {finding.url ? (
                    <a href={finding.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {finding.title}
                    </a>
                  ) : (
                    finding.title
                  )}
                  {finding.advisories > 1 ? ` and ${finding.advisories - 1} more` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {audit.status === "VULNERABLE" ? (
        <p className="text-muted mt-3 text-xs">
          Run npm audit in the project to see how to fix these. Its totals can be higher, because it also counts the
          packages that depend on a vulnerable one.
        </p>
      ) : null}
    </Card>
  );
}
