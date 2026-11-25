"use client";

import { ChevronDown, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Input } from "@/components/ui/form";
import { Badge, Card, ColorDot, EmptyState, PageHeader } from "@/components/ui/misc";
import type { AuditReport } from "@/lib/audit/service";
import { cn } from "@/lib/utils";
import { AuditResult, CheckedLine, FindingsList } from "./dependency-audit";

type Row = AuditReport["projects"][number];
type Group = "vulnerable" | "clear" | "unsure" | "unlinked";

/** Which of the four counts at the top of the page a project belongs to. */
function groupOf(row: Row): Group {
  if (!row.repository) return "unlinked";
  if (row.status === "VULNERABLE") return "vulnerable";
  // A clear result whose latest check failed is no longer known to be clear.
  return row.status === "CLEAR" && !row.error ? "clear" : "unsure";
}

const GROUPS: { key: Group; label: string; hint: string; tone?: string }[] = [
  { key: "vulnerable", label: "Vulnerable", hint: "Have packages with advisories", tone: "text-danger" },
  { key: "clear", label: "Clear", hint: "Nothing found on the last check", tone: "text-success-text" },
  { key: "unsure", label: "Not confirmed", hint: "Not checked yet, failing, or no package-lock.json", tone: "text-warning-text" },
  { key: "unlinked", label: "No repository", hint: "Not checked until one is linked" },
];

export function AuditsView({ report, showDepartment }: { report: AuditReport; showDepartment: boolean }) {
  const [filter, setFilter] = useState<Group | "all">("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const counts = useMemo(() => {
    const result: Record<Group, number> = { vulnerable: 0, clear: 0, unsure: 0, unlinked: 0 };
    for (const row of report.projects) result[groupOf(row)] += 1;
    return result;
  }, [report.projects]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return report.projects.filter(
      (row) =>
        (filter === "all" || groupOf(row) === filter) &&
        (!term ||
          [row.name, row.code, row.repository ?? "", row.department.name].some((text) => text.toLowerCase().includes(term))),
    );
  }, [report.projects, filter, search]);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const columns = showDepartment ? 6 : 5;

  return (
    <>
      <PageHeader
        title="Dependency audit"
        description="Every project's npm dependencies, checked against npm's advisories once a day, whether or not anyone is working on it."
      />

      {report.configured ? null : (
        <Card className="text-warning-text mb-4 p-4 text-sm">
          Bitbucket isn&apos;t connected, so nothing is being checked. A manager connects their account in Settings, or a Super Admin adds a token in Site settings.
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {GROUPS.map((group) => {
          const selected = filter === group.key;
          return (
            <button
              key={group.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setFilter(selected ? "all" : group.key)}
              className={cn(
                "bg-surface hover:border-primary rounded-xl border p-4 text-left transition-colors duration-150",
                selected && "border-primary ring-primary ring-1",
              )}
            >
              <p className="text-muted text-xs">{group.label}</p>
              <p className={cn("mt-1 text-2xl font-bold", counts[group.key] ? group.tone : undefined)}>{counts[group.key]}</p>
              <p className="text-muted mt-0.5 text-xs">{group.hint}</p>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
          <Input
            type="search"
            aria-label="Search projects"
            placeholder="Search projects or repositories"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <p className="text-muted-on-background text-sm" aria-live="polite">
          {rows.length} of {report.projects.length} project{report.projects.length === 1 ? "" : "s"}
          {filter === "all" ? "" : ` · ${GROUPS.find((group) => group.key === filter)!.label}`}
          {filter === "all" ? null : (
            <button type="button" className="text-primary ml-2 font-medium underline" onClick={() => setFilter("all")}>
              Show all
            </button>
          )}
        </p>
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={report.projects.length === 0 ? "No projects yet" : "No projects match"}
            description={
              report.projects.length === 0
                ? "Projects you can see appear here with their audit results."
                : "Try another search, or show all projects."
            }
          />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-muted border-b text-xs">
                <tr>
                  <th className="py-3 pr-3 pl-5 font-medium">Project</th>
                  {showDepartment ? <th className="px-3 py-3 font-medium">Department</th> : null}
                  <th className="px-3 py-3 font-medium">Repository</th>
                  <th className="px-3 py-3 font-medium">Result</th>
                  <th className="px-3 py-3 font-medium">Checked</th>
                  <th className="py-3 pr-5 pl-3 text-right font-medium">Packages</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const expanded = open.has(row.id);
                  return (
                    <Fragment key={row.id}>
                      <tr className={cn("border-b", expanded ? "border-b-0" : "last:border-0")}>
                        <td className="py-3 pr-3 pl-5">
                          <Link href={`/projects/${row.id}`} className="flex items-center gap-2 font-medium hover:underline">
                            <ColorDot color={row.color} />
                            {row.name}
                          </Link>
                          <p className="text-muted pl-[1.125rem] text-xs">
                            {row.code}
                            {row.projectStatus === "Active" ? "" : ` · ${row.projectStatus}`}
                          </p>
                        </td>
                        {showDepartment ? (
                          <td className="px-3 py-3">
                            <span className="flex items-center gap-2">
                              <ColorDot color={row.department.color} />
                              {row.department.name}
                            </span>
                          </td>
                        ) : null}
                        <td className="text-muted px-3 py-3 break-all">{row.repository ?? "—"}</td>
                        <td className="px-3 py-3">
                          {row.repository ? (
                            <span className="flex justify-start">
                              <AuditResult audit={row} />
                            </span>
                          ) : (
                            <Badge className="text-muted">No repository</Badge>
                          )}
                        </td>
                        <td className="text-muted max-w-64 px-3 py-3 text-xs">
                          {row.repository ? <CheckedLine audit={row} /> : "Link a repository under Edit on the project"}
                        </td>
                        <td className="py-3 pr-5 pl-3 text-right">
                          {row.findings.length > 0 ? (
                            <button
                              type="button"
                              aria-expanded={expanded}
                              onClick={() => toggle(row.id)}
                              className="text-primary inline-flex items-center gap-1 font-medium whitespace-nowrap hover:underline"
                            >
                              {expanded ? "Hide" : `Show ${row.findings.length}`}
                              <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} aria-hidden />
                            </button>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="border-b last:border-0">
                          <td colSpan={columns} className="bg-subtle/50 px-5 pb-3">
                            <FindingsList findings={row.findings} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
