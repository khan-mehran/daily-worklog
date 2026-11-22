"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Pencil, Plus, Search, UserRoundX, Users, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AddDepartmentDialog } from "@/components/departments/department-dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Avatar, Badge, Card, ColorDot, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { api, apiRequest, type Paginated } from "@/lib/api-client";
import {
  APPROVAL_LABELS,
  APPROVALS,
  ROLE_LABELS,
  ROLES,
  seesAllDepartments,
  type Approval,
  type Role,
} from "@/lib/constants";
import type { UserRow } from "@/lib/users/serialise";
import { cn } from "@/lib/utils";
import { UserDialog, type UserDialogMode } from "./user-dialog";

const PAGE_SIZE = 20;

const isApproval = (value: string | null): value is Approval =>
  APPROVALS.includes(value as Approval);

function StatusBadge({ row }: { row: UserRow }) {
  if (row.approval === "PENDING") {
    return (
      <Badge className="border-warning/40 text-warning-text">
        <Clock className="size-3" aria-hidden />
        {APPROVAL_LABELS.PENDING}
      </Badge>
    );
  }
  if (row.approval === "REJECTED") return <Badge className="text-danger">{APPROVAL_LABELS.REJECTED}</Badge>;
  return row.isActive ? <Badge className="text-success-text">Active</Badge> : <Badge className="text-muted">Inactive</Badge>;
}

/**
 * The Users page. Everyone signs in with Microsoft: a first sign-in lands here as "Waiting for
 * approval", and an admin approves it with a role and department, or rejects it.
 */
export function UsersView({ viewer }: { viewer: { id: string; role: Role } }) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState<Approval | "all">(isApproval(initialStatus) ? initialStatus : "all");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ mode: UserDialogMode; user: UserRow | null }>({
    mode: "create",
    user: null,
  });
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [addingDepartment, setAddingDepartment] = useState(false);
  const isSuperAdmin = viewer.role === "SUPER_ADMIN";

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (role !== "all") params.set("role", role);
  if (status !== "all") params.set("approval", status);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["users", "list", params.toString()],
    queryFn: () => apiRequest<Paginated<UserRow>>(`/api/users?${params}`),
    placeholderData: keepPreviousData,
  });
  const { data: waiting } = useQuery({
    queryKey: ["users", "waiting-count"],
    queryFn: () => apiRequest<Paginated<UserRow>>("/api/users?approval=PENDING&limit=1"),
  });
  const waitingCount = waiting?.meta.total ?? 0;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["users"] });
  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api(`/api/users/${id}`, { method: "PATCH", body: { isActive } }),
    onSuccess: async (_data, { isActive }) => {
      toast.success(isActive ? "User reactivated." : "User deactivated.");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const reject = useMutation({
    mutationFn: (row: UserRow) => api(`/api/users/${row.id}/reject`, { method: "POST" }),
    onSuccess: async (_data, row) => {
      toast.success(`${row.name}'s request was rejected.`);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const openDialog = (mode: UserDialogMode, user: UserRow | null) => {
    setDialog({ mode, user });
    setUserDialogOpen(true);
  };

  /** A Super Admin edits anyone. The CEO edits people in departments, as before. */
  const canEdit = (row: UserRow) => isSuperAdmin || !seesAllDepartments(row.role);

  return (
    <>
      <PageHeader
        title="Users"
        description="Approve people who sign in with Microsoft, and set their role, department and who they report to."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setAddingDepartment(true)}>
              <Plus />
              Add department
            </Button>
            <Button onClick={() => openDialog("create", null)}>
              <Plus />
              Add user
            </Button>
          </div>
        }
      />

      {waitingCount > 0 && status !== "PENDING" ? (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Clock className="text-warning size-4" aria-hidden />
            {waitingCount === 1
              ? "1 person is waiting for approval."
              : `${waitingCount} people are waiting for approval.`}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setStatus("PENDING");
              setPage(1);
            }}
          >
            Review
          </Button>
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <Search className="text-muted absolute top-3 left-3 size-4" aria-hidden />
          <Input
            aria-label="Search by name or email"
            placeholder="Search by name or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          aria-label="Filter by status"
          className="w-52"
          value={status}
          onValueChange={(value) => {
            setStatus(value as Approval | "all");
            setPage(1);
          }}
          options={[
            { value: "all", label: "All statuses" },
            ...APPROVALS.map((value) => ({ value, label: APPROVAL_LABELS[value] })),
          ]}
        />
        <Select
          aria-label="Filter by role"
          className="w-40"
          value={role}
          onValueChange={(value) => {
            setRole(value);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All roles" },
            ...ROLES.map((value) => ({ value, label: ROLE_LABELS[value] })),
          ]}
        />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5" role="status" aria-label="Loading">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={Users}
            title="Couldn't load users"
            description="Check your connection and try again."
            action={
              <Button variant="secondary" onClick={() => refetch()}>
                Try again
              </Button>
            }
          />
        ) : data?.data.length === 0 ? (
          status === "PENDING" && !debouncedSearch && role === "all" ? (
            <EmptyState
              icon={Check}
              title="Nobody is waiting"
              description="When someone signs in with Microsoft for the first time, they appear here for approval."
            />
          ) : (
            <EmptyState
              icon={Search}
              title="No users match"
              description="Try a different search, status or role."
            />
          )
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-muted border-b text-xs">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Role</th>
                  <th className="px-3 py-3 font-medium">Department</th>
                  <th className="px-3 py-3 font-medium">Reports to</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {data?.data.map((row) => {
                  const approved = row.approval === "APPROVED";
                  return (
                    <tr key={row.id} className={cn("border-b last:border-0", !approved && "bg-subtle/50")}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={row.name} color={row.avatarColor} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {row.name}
                              {row.id === viewer.id ? <span className="text-muted font-normal"> (you)</span> : null}
                            </p>
                            <p className="text-muted truncate text-xs">{row.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {approved ? ROLE_LABELS[row.role] : <span className="text-muted">Not set</span>}
                      </td>
                      <td className="px-3 py-3">
                        {row.department ? (
                          <span className="flex items-center gap-2">
                            <ColorDot color={row.department.color} />
                            {row.department.name}
                          </span>
                        ) : (
                          <span className="text-muted">
                            {approved && seesAllDepartments(row.role) ? "All" : approved ? "Unassigned" : "Not set"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {row.reportsTo?.name ?? <span className="text-muted">Nobody</span>}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge row={row} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          {approved ? (
                            canEdit(row) ? (
                              <>
                                <Button variant="ghost" size="sm" onClick={() => openDialog("edit", row)}>
                                  <Pencil />
                                  Edit
                                </Button>
                                {row.id === viewer.id ? null : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={setActive.isPending}
                                    onClick={() => setActive.mutate({ id: row.id, isActive: !row.isActive })}
                                  >
                                    <UserRoundX />
                                    {row.isActive ? "Deactivate" : "Reactivate"}
                                  </Button>
                                )}
                              </>
                            ) : null
                          ) : (
                            <>
                              <Button size="sm" onClick={() => openDialog("approve", row)}>
                                <Check />
                                Approve
                              </Button>
                              {row.approval === "PENDING" ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={reject.isPending}
                                  onClick={() => reject.mutate(row)}
                                >
                                  <X />
                                  Reject
                                </Button>
                              ) : null}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={data?.meta.total ?? 0}
        noun="users"
        onPageChange={setPage}
      />

      <UserDialog
        user={dialog.user}
        mode={dialog.mode}
        canAssignOrgWideRoles={isSuperAdmin}
        open={userDialogOpen}
        onOpenChange={setUserDialogOpen}
      />
      <AddDepartmentDialog open={addingDepartment} onOpenChange={setAddingDepartment} />
    </>
  );
}
