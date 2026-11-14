"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, Card, ColorDot, EmptyState, PageHeader, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api-client";
import type { DepartmentSummary } from "@/lib/departments/service";
import { AddDepartmentDialog, DEPARTMENTS_KEY } from "./department-dialogs";

function DepartmentCard({ department }: { department: DepartmentSummary }) {
  return (
    <Link
      href={`/departments/${department.id}`}
      className="bg-surface hover:border-primary block rounded-xl border p-5 transition-colors duration-150"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold">
            <ColorDot color={department.color} />
            <span className="truncate">{department.name}</span>
          </h2>
          <p className="text-muted mt-0.5 text-xs">{department.code}</p>
        </div>
        {department.status === "Archived" ? <Badge className="text-muted">Archived</Badge> : null}
      </div>
      <div className="mt-4 flex items-center gap-2 text-sm">
        {department.manager ? (
          <>
            <Avatar
              name={department.manager.name}
              color={department.manager.avatarColor}
              className="size-7 text-[10px]"
            />
            <span className="truncate">{department.manager.name}</span>
          </>
        ) : (
          <span className="text-muted">No manager assigned</span>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t pt-4 text-sm">
        <div>
          <dt className="text-muted text-xs">People</dt>
          <dd className="mt-0.5 font-semibold">{department.headcount}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Active projects</dt>
          <dd className="mt-0.5 font-semibold">{department.activeProjects}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Submitted this week</dt>
          <dd className="mt-0.5 font-semibold">{department.submissionRate}%</dd>
        </div>
      </dl>
    </Link>
  );
}

export function useDepartments() {
  return useQuery({
    queryKey: DEPARTMENTS_KEY,
    queryFn: () => api<DepartmentSummary[]>("/api/departments"),
  });
}

export function DepartmentsView() {
  const [adding, setAdding] = useState(false);
  const { data, isLoading, isError, refetch } = useDepartments();

  const addButton = (
    <Button onClick={() => setAdding(true)}>
      <Plus />
      Add department
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Departments"
        description="Each department is run by its own manager and sees only its own data."
        actions={addButton}
      />
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <EmptyState
            icon={Users}
            title="Couldn't load departments"
            description="Check your connection and try again."
            action={
              <Button variant="secondary" onClick={() => refetch()}>
                Try again
              </Button>
            }
          />
        </Card>
      ) : data?.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="No departments yet"
            description="Add your first department and assign its manager."
            action={addButton}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data?.map((department) => (
            <DepartmentCard key={department.id} department={department} />
          ))}
        </div>
      )}
      <AddDepartmentDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
