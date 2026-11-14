"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BarChart3,
  ListChecks,
  OctagonAlert,
  Pencil,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { LazyWeeklyHoursChart } from "@/components/charts/lazy-weekly-hours-chart";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Avatar, Badge, Card, ColorDot, EmptyState, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api-client";
import { paletteVar, ROLE_LABELS, type Role } from "@/lib/constants";
import type { ProjectDetail } from "@/lib/projects/service";
import { cn, formatDay } from "@/lib/utils";
import { ProjectStatusBadge } from "./project-badges";
import { ManageMembersDialog, ProjectDialog, PROJECTS_KEY } from "./project-dialogs";

/** Hours on this page depend on the viewer, so each role is told what the numbers cover. */
const ACTIVITY_SCOPE: Record<Role, string> = {
  CEO: "Only fully approved reports count.",
  MANAGER: "Your own work, your team leads' submitted reports and reports your team leads approved.",
  TEAM_LEAD: "Your own work and your direct reports' submitted reports.",
  DEVELOPER: "Your own work on this project.",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-5">
      <p className="text-muted text-sm">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </Card>
  );
}

export function ProjectDetailView({
  project,
  role,
  canManage,
}: {
  project: ProjectDetail;
  role: Role;
  canManage: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<"edit" | "members" | "delete" | null>(null);
  const { activity } = project;

  const remove = useMutation({
    mutationFn: () => api(`/api/projects/${project.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success(`${project.name} deleted.`);
      await queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
      router.replace("/projects");
    },
    onError: (error) => {
      setDialog(null);
      toast.error(error.message);
    },
  });

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-3">
        <Link href="/projects">
          <ArrowLeft />
          All projects
        </Link>
      </Button>
      <PageHeader
        title={project.name}
        description={project.description || `Project code ${project.code}`}
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setDialog("edit")}>
                <Pencil />
                Edit
              </Button>
              <Button variant="secondary" onClick={() => setDialog("members")}>
                <Users />
                Manage members
              </Button>
              <Button variant="secondary" onClick={() => setDialog("delete")}>
                <Trash2 />
                Delete
              </Button>
            </div>
          ) : null
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <Badge>
          <ColorDot color={project.color} />
          {project.code}
        </Badge>
        <ProjectStatusBadge status={project.status} />
        {role === "CEO" ? (
          <Badge>
            <ColorDot color={project.department.color} />
            {project.department.name}
          </Badge>
        ) : null}
        {project.startDate || project.endDate ? (
          <span className="text-muted-on-background">
            {project.startDate ? formatDay(project.startDate) : "No start date"}
            {" – "}
            {project.endDate ? formatDay(project.endDate) : "no end date"}
          </span>
        ) : null}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Hours logged" value={activity.totalHours} />
        <Stat label="Contributors" value={activity.contributorCount} />
        <Stat label="Blocked tasks" value={activity.blockedCount} />
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <h2 className="font-semibold">Hours logged per week</h2>
          <p className="text-muted mb-3 text-sm">{ACTIVITY_SCOPE[role]}</p>
          {activity.byWeek.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No hours to show yet"
              description="Hours appear here as work is logged and reaches you."
            />
          ) : (
            <>
              <LazyWeeklyHoursChart
                data={activity.byWeek}
                fill={paletteVar(project.color)}
                title={`Hours logged per week on ${project.name}`}
              />
              <p className="text-muted mt-2 flex items-center gap-2 text-xs">
                <ColorDot color={project.color} />
                {project.name}
              </p>
            </>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">
            Members <span className="text-muted font-normal">({project.members.length})</span>
          </h2>
          {project.members.length === 0 ? (
            <p className="text-muted mt-3 text-sm">Nobody is assigned yet.</p>
          ) : (
            <ul className="mt-3 max-h-64 space-y-3 overflow-y-auto">
              {project.members.map((member) => (
                <li key={member.id} className="flex items-center gap-3 text-sm">
                  <Avatar name={member.name} color={member.avatarColor} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{member.name}</p>
                    <p className="text-muted text-xs">{ROLE_LABELS[member.role as Role]}</p>
                  </div>
                  {member.isActive ? null : <Badge className="text-muted ml-auto">Inactive</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold">Recent tasks</h2>
        <p className="text-muted mb-3 text-sm">{ACTIVITY_SCOPE[role]}</p>
        {activity.recentTasks.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No tasks to show yet"
            description="Tasks appear here as work is logged and reaches you."
          />
        ) : (
          <ul className="divide-y">
            {activity.recentTasks.map((task) => (
              <li key={task.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <Avatar name={task.user.name} color={task.user.avatarColor} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{task.details}</p>
                  <p className="text-muted mt-1 text-xs">
                    {task.user.name}
                    {task.date ? ` · ${formatDay(task.date)}` : ""}
                    {task.hours !== null ? ` · ${task.hours}h` : ""}
                  </p>
                </div>
                <Badge
                  className={cn(
                    task.status === "Blocked" && "border-danger text-danger",
                    task.status === "In Progress" && "text-info",
                    task.status === "Completed" && "text-success-text",
                  )}
                >
                  {task.status === "Blocked" ? <OctagonAlert className="size-3" aria-hidden /> : null}
                  {task.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canManage ? (
        <>
          <ProjectDialog
            project={project}
            open={dialog === "edit"}
            onOpenChange={(open) => setDialog(open ? "edit" : null)}
          />
          <ManageMembersDialog
            project={project}
            open={dialog === "members"}
            onOpenChange={(open) => setDialog(open ? "members" : null)}
          />
          <ConfirmDialog
            open={dialog === "delete"}
            onOpenChange={(open) => setDialog(open ? "delete" : null)}
            title={`Delete ${project.name}?`}
            description="This can't be undone. A project with logged work can't be deleted, so mark it as Completed instead."
            confirmLabel="Delete project"
            danger
            pending={remove.isPending}
            onConfirm={() => remove.mutate()}
          />
        </>
      ) : null}
    </>
  );
}
