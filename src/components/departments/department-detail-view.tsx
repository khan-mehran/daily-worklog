"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ArrowLeft, BarChart3, Pencil, Trash2, UserCog } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { LazyWeeklyHoursChart } from "@/components/charts/lazy-weekly-hours-chart";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Avatar, Badge, Card, ColorDot, EmptyState, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api-client";
import { paletteVar } from "@/lib/constants";
import type { DepartmentDetail } from "@/lib/departments/service";
import {
  ChangeManagerDialog,
  DEPARTMENTS_KEY,
  EditDepartmentDialog,
} from "./department-dialogs";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-5">
      <p className="text-muted text-sm">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </Card>
  );
}

function PeopleList({
  title,
  people,
}: {
  title: string;
  people: { id: string; name: string; email: string; avatarColor: string; isActive: boolean }[];
}) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold">
        {title} <span className="text-muted font-normal">({people.length})</span>
      </h2>
      {people.length === 0 ? (
        <p className="text-muted mt-3 text-sm">Nobody here yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-3 text-sm">
              <Avatar name={person.name} color={person.avatarColor} />
              <div className="min-w-0">
                <p className="truncate font-medium">{person.name}</p>
                <p className="text-muted truncate text-xs">{person.email}</p>
              </div>
              {person.isActive ? null : <Badge className="text-muted ml-auto">Inactive</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function DepartmentDetailView({ department }: { department: DepartmentDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<"edit" | "manager" | "archive" | "delete" | null>(null);
  const archived = department.status === "Archived";

  const action = useMutation({
    mutationFn: (kind: "archive" | "restore" | "delete") =>
      kind === "delete"
        ? api(`/api/departments/${department.id}`, { method: "DELETE" })
        : api(`/api/departments/${department.id}/${kind}`, { method: "POST" }),
    onSuccess: async (_data, kind) => {
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: DEPARTMENTS_KEY });
      if (kind === "delete") {
        toast.success(`${department.name} deleted.`);
        router.replace("/departments");
      } else {
        toast.success(kind === "archive" ? "Department archived." : "Department restored.");
      }
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const maxProjectHours = Math.max(1, ...department.approved.byProject.map((row) => row.hours));

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-3">
        <Link href="/departments">
          <ArrowLeft />
          All departments
        </Link>
      </Button>
      <PageHeader
        title={department.name}
        description={department.description || `Department code ${department.code}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog("edit")}>
              <Pencil />
              Edit
            </Button>
            {archived || department.ledBySuperAdmin ? null : (
              <Button variant="secondary" onClick={() => setDialog("manager")}>
                <UserCog />
                Change manager
              </Button>
            )}
            {archived ? (
              <Button
                variant="secondary"
                disabled={action.isPending}
                onClick={() => action.mutate("restore")}
              >
                <ArchiveRestore />
                Restore
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setDialog("archive")}>
                <Archive />
                Archive
              </Button>
            )}
            {department.canDelete ? (
              <Button variant="secondary" onClick={() => setDialog("delete")}>
                <Trash2 />
                Delete
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge>
          <ColorDot color={department.color} />
          {department.code}
        </Badge>
        {archived ? <Badge className="text-muted">Archived</Badge> : null}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="People" value={department.headcount} />
        <Stat label="Active projects" value={department.activeProjects} />
        <Stat label="Submitted this week" value={`${department.submissionRate}%`} />
        <Stat label="Approved hours, last 6 weeks" value={department.approved.totalHours} />
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold">Approved hours per week</h2>
          <p className="text-muted mb-3 text-sm">Only reports approved by the manager count.</p>
          {department.approved.byWeek.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No approved reports yet"
              description="Hours appear here once the manager approves a report."
            />
          ) : (
            <LazyWeeklyHoursChart
              data={department.approved.byWeek}
              fill="var(--primary)"
              title="Approved hours per week"
              unit="approved hours"
            />
          )}
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Approved hours by project</h2>
          <p className="text-muted mb-3 text-sm">Last 6 weeks, highest first.</p>
          {department.approved.byProject.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No approved hours yet"
              description="Project totals appear once reports are approved."
            />
          ) : (
            <ul className="space-y-3">
              {department.approved.byProject.map((row) => (
                <li key={row.name} className="text-sm">
                  <div className="mb-1 flex justify-between gap-3">
                    <span className="truncate">{row.name}</span>
                    <span className="font-semibold">{row.hours}h</span>
                  </div>
                  <div className="bg-subtle h-2 rounded-full" aria-hidden>
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${(row.hours / maxProjectHours) * 100}%`,
                        background: paletteVar(row.color),
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PeopleList
          title={department.ledBySuperAdmin ? "Led by the Super Admin" : "Manager"}
          people={department.manager ? [{ ...department.manager, isActive: true }] : []}
        />
        <PeopleList title="Team leads" people={department.teamLeads} />
        <PeopleList title="Developers" people={department.developers} />
        <Card className="p-5">
          <h2 className="font-semibold">
            Projects <span className="text-muted font-normal">({department.projects.length})</span>
          </h2>
          {department.projects.length === 0 ? (
            <p className="text-muted mt-3 text-sm">No projects yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {department.projects.map((project) => (
                <li key={project.id} className="flex items-center gap-2 text-sm">
                  <ColorDot color={project.color} />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <Badge className="text-muted">{project.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <EditDepartmentDialog
        department={department}
        open={dialog === "edit"}
        onOpenChange={(open) => setDialog(open ? "edit" : null)}
      />
      <ChangeManagerDialog
        departmentId={department.id}
        departmentName={department.name}
        open={dialog === "manager"}
        onOpenChange={(open) => setDialog(open ? "manager" : null)}
      />
      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={(open) => setDialog(open ? "archive" : null)}
        title={`Archive ${department.name}?`}
        description="Its data stays intact. It leaves the department switcher, and nobody can be added to it until you restore it."
        confirmLabel="Archive department"
        pending={action.isPending}
        onConfirm={() => action.mutate("archive")}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
        title={`Delete ${department.name}?`}
        description="This department has no data, so it can be deleted. Its manager becomes unassigned. This can't be undone."
        confirmLabel="Delete department"
        danger
        pending={action.isPending}
        onConfirm={() => action.mutate("delete")}
      />
    </>
  );
}
