"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, UserRoundX, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AddDepartmentDialog } from "@/components/departments/department-dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Avatar, Badge, Card, ColorDot, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { api, apiRequest, type Paginated } from "@/lib/api-client";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import type { UserRow } from "@/lib/users/serialise";
import { UserDialog } from "./user-dialog";

const PAGE_SIZE = 20;

export function AdminView() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [role, setRole] = useState("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [addingDepartment, setAddingDepartment] = useState(false);

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

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["users", "admin", params.toString()],
    queryFn: () => apiRequest<Paginated<UserRow>>(`/api/users?${params}`),
    placeholderData: keepPreviousData,
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api(`/api/users/${id}`, { method: "PATCH", body: { isActive } }),
    onSuccess: async (_data, { isActive }) => {
      toast.success(isActive ? "User reactivated." : "User deactivated.");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <PageHeader
        title="Admin"
        description="Create users, change roles and set who reports to whom."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setAddingDepartment(true)}>
              <Plus />
              Add department
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setUserDialogOpen(true);
              }}
            >
              <Plus />
              Add user
            </Button>
          </div>
        }
      />

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
          aria-label="Filter by role"
          className="w-40"
          value={role}
          onValueChange={(value) => {
            setRole(value);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All roles" },
            ...(Object.keys(ROLE_LABELS) as Role[]).map((value) => ({
              value,
              label: ROLE_LABELS[value],
            })),
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
          <EmptyState
            icon={Search}
            title="No users match"
            description="Try a different search, role or department."
          />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-muted border-b text-xs">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Role</th>
                  <th className="px-3 py-3 font-medium">Department</th>
                  <th className="px-3 py-3 font-medium">Reports to</th>
                  <th className="px-5 py-3 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data?.data.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={row.name} color={row.avatarColor} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{row.name}</p>
                          <p className="text-muted truncate text-xs">{row.email}</p>
                        </div>
                        {row.isActive ? null : <Badge className="text-muted">Inactive</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-3">{ROLE_LABELS[row.role as Role]}</td>
                    <td className="px-3 py-3">
                      {row.department ? (
                        <span className="flex items-center gap-2">
                          <ColorDot color={row.department.color} />
                          {row.department.name}
                        </span>
                      ) : (
                        <span className="text-muted">{row.role === "CEO" ? "All" : "Unassigned"}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {row.reportsTo?.name ?? <span className="text-muted">Nobody</span>}
                    </td>
                    <td className="px-5 py-3">
                      {row.role === "CEO" ? null : (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(row);
                              setUserDialogOpen(true);
                            }}
                          >
                            <Pencil />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={setActive.isPending}
                            onClick={() =>
                              setActive.mutate({ id: row.id, isActive: !row.isActive })
                            }
                          >
                            <UserRoundX />
                            {row.isActive ? "Deactivate" : "Reactivate"}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
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

      <UserDialog user={editing} open={userDialogOpen} onOpenChange={setUserDialogOpen} />
      <AddDepartmentDialog open={addingDepartment} onOpenChange={setAddingDepartment} />
    </>
  );
}
