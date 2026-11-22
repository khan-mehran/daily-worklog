"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarDays, FolderKanban, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Avatar, Badge, Card, ColorDot, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { apiRequest, type Paginated } from "@/lib/api-client";
import { paletteVar, PROJECT_STATUSES, type Role } from "@/lib/constants";
import type { ProjectSummary } from "@/lib/projects/service";
import { formatDay } from "@/lib/utils";
import { ProjectStatusBadge } from "./project-badges";
import { PROJECTS_KEY, ProjectDialog } from "./project-dialogs";
import { seesAllDepartments } from "@/lib/constants";

const PAGE_SIZE = 12;
const VISIBLE_AVATARS = 4;

const DESCRIPTIONS: Record<Role, string> = {
  SUPER_ADMIN: "Every project across all departments. Projects are managed by their departments.",
  CEO: "Every project across all departments. Projects are managed by their departments.",
  MANAGER: "All of your department's projects.",
  TEAM_LEAD: "All of your department's projects.",
  DEVELOPER: "The projects you're assigned to.",
};

function ProjectCard({ project, showDepartment }: { project: ProjectSummary; showDepartment: boolean }) {
  const extra = project.members.length - VISIBLE_AVATARS;
  return (
    <Link
      href={`/projects/${project.id}`}
      className="bg-surface hover:border-primary flex flex-col overflow-hidden rounded-xl border transition-colors duration-150"
    >
      <span aria-hidden className="h-1.5" style={{ background: paletteVar(project.color) }} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{project.name}</h2>
            <p className="text-muted mt-0.5 text-xs">{project.code}</p>
          </div>
          <ProjectStatusBadge status={project.status} />
        </div>
        {project.description ? (
          <p className="text-muted mt-3 line-clamp-2 text-sm">{project.description}</p>
        ) : null}
        {showDepartment ? (
          <div className="mt-3">
            <Badge>
              <ColorDot color={project.department.color} />
              {project.department.name}
            </Badge>
          </div>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          {project.members.length === 0 ? (
            <span className="text-muted text-xs">No members yet</span>
          ) : (
            <div
              className="flex -space-x-2"
              role="img"
              aria-label={`${project.members.length} members`}
            >
              {project.members.slice(0, VISIBLE_AVATARS).map((member) => (
                <Avatar
                  key={member.id}
                  name={member.name}
                  color={member.avatarColor}
                  className="size-7 text-[10px]"
                />
              ))}
              {extra > 0 ? (
                <span className="bg-subtle inline-flex size-7 items-center justify-center rounded-full border-2 text-[10px] font-bold">
                  +{extra}
                </span>
              ) : null}
            </div>
          )}
          {project.endDate ? (
            <span className="text-muted flex items-center gap-1 text-xs">
              <CalendarDays className="size-3" aria-hidden />
              Due {formatDay(project.endDate)}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export function ProjectsView({
  role,
  canManage,
  departmentId,
}: {
  role: Role;
  canManage: boolean;
  /** The department new projects go to. Null for people who can't add any. */
  departmentId: string | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  useEffect(() => setPage(1), [debouncedSearch, status]);

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (status !== "all") params.set("status", status);

  // The CEO's department switcher applies on the server, through its cookie.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...PROJECTS_KEY, params.toString()],
    queryFn: () => apiRequest<Paginated<ProjectSummary>>(`/api/projects?${params}`),
    placeholderData: keepPreviousData,
  });

  const filtered = Boolean(debouncedSearch) || status !== "all";
  const addButton = canManage ? (
    <Button onClick={() => setAdding(true)}>
      <Plus />
      Add project
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Projects" description={
          role === "SUPER_ADMIN" && canManage
            ? "Every project across all departments. You add and manage the projects of the department you lead."
            : DESCRIPTIONS[role]
        }
        actions={addButton} />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <Search className="text-muted absolute top-3 left-3 size-4" aria-hidden />
          <Input
            aria-label="Search by name or code"
            placeholder="Search by name or code"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          aria-label="Filter by status"
          className="w-40"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: "all", label: "All statuses" },
            ...PROJECT_STATUSES.map((value) => ({ value, label: value })),
          ]}
        />
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <EmptyState
            icon={FolderKanban}
            title="Couldn't load projects"
            description="Check your connection and try again."
            action={
              <Button variant="secondary" onClick={() => refetch()}>
                Try again
              </Button>
            }
          />
        </Card>
      ) : data?.data.length === 0 ? (
        <Card>
          {filtered ? (
            <EmptyState
              icon={Search}
              title="No projects match"
              description="Try a different search or status."
            />
          ) : (
            <EmptyState
              icon={FolderKanban}
              title={role === "DEVELOPER" ? "You're not on any projects yet" : "No projects yet"}
              description={
                role === "DEVELOPER"
                  ? "Your Team Lead or Manager will assign you to a project."
                  : canManage
                    ? "Add your department's first project and assign people to it."
                    : "Projects appear here once departments create them."
              }
              action={addButton}
            />
          )}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data?.data.map((project) => (
            <ProjectCard key={project.id} project={project} showDepartment={seesAllDepartments(role)} />
          ))}
        </div>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={data?.meta.total ?? 0}
        noun="projects"
        onPageChange={setPage}
      />

      {canManage ? (
        <ProjectDialog
          open={adding}
          onOpenChange={setAdding}
          departmentId={departmentId}
          onCreated={(id) => router.push(`/projects/${id}`)}
        />
      ) : null}
    </>
  );
}
