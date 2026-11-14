"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { ColorDot } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { api, ApiClientError } from "@/lib/api-client";
import { REPORTS_TO_ROLE, ROLE_LABELS } from "@/lib/constants";
import type { DepartmentSummary } from "@/lib/departments/service";
import type { UserRow } from "@/lib/users/serialise";
import { createUserSchema, updateUserSchema } from "@/validators/user";

type AssignableRole = "MANAGER" | "TEAM_LEAD" | "DEVELOPER";

interface FormState {
  name: string;
  email: string;
  role: AssignableRole;
  departmentId: string;
  reportsTo: string;
}

const ROLE_OPTIONS = (["MANAGER", "TEAM_LEAD", "DEVELOPER"] as const).map((value) => ({
  value,
  label: ROLE_LABELS[value],
}));

const initialState = (user: UserRow | null): FormState => ({
  name: user?.name ?? "",
  email: user?.email ?? "",
  role: user && user.role !== "CEO" ? (user.role as AssignableRole) : "DEVELOPER",
  departmentId: user?.department?.id ?? "",
  reportsTo: user?.reportsTo?.id ?? "",
});

/**
 * Create or edit a user. The server enforces every placement rule. This form only narrows the
 * choices: Team Leads are assigned to their department's manager, and Managers get a department
 * from the Departments page.
 */
export function UserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<FormState>(() => initialState(user));
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setState(initialState(user));
      setErrors({});
    }
  }, [open, user]);

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api<DepartmentSummary[]>("/api/departments"),
    enabled: open,
  });

  const needsLead = state.role === "DEVELOPER" && Boolean(state.departmentId);
  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ["users", "leads", state.departmentId],
    queryFn: () =>
      api<UserRow[]>(
        `/api/users?role=${REPORTS_TO_ROLE.DEVELOPER}&departmentId=${state.departmentId}&active=true&limit=100`,
      ),
    enabled: open && needsLead,
  });

  const save = useMutation({
    mutationFn: async () => {
      const placement = {
        role: state.role,
        departmentId: state.role === "MANAGER" ? null : state.departmentId || null,
        reportsTo: state.role === "DEVELOPER" ? state.reportsTo || null : null,
      };
      if (user) {
        const isManagerKeepingDepartment = user.role === "MANAGER" && state.role === "MANAGER";
        const body = updateUserSchema.parse(
          isManagerKeepingDepartment
            ? { name: state.name }
            : state.role === "TEAM_LEAD"
              ? { name: state.name, role: state.role, departmentId: placement.departmentId }
              : { name: state.name, ...placement },
        );
        return api(`/api/users/${user.id}`, { method: "PATCH", body });
      }
      const body = createUserSchema.parse({ name: state.name, email: state.email, ...placement });
      return api("/api/users", { method: "POST", body });
    },
    onSuccess: async () => {
      toast.success(user ? "User updated." : "User created and invited by email.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        queryClient.invalidateQueries({ queryKey: ["departments"] }),
      ]);
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiClientError || !("issues" in error)) {
        toast.error(error.message);
        return;
      }
      const issues = (error as unknown as { issues: { path: string[]; message: string }[] }).issues;
      setErrors(
        Object.fromEntries(issues.map((issue) => [String(issue.path[0]), issue.message])),
      );
    },
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((current) => ({ ...current, [key]: value }));

  const departmentOptions = (departments ?? [])
    .filter((department) => department.status === "Active")
    .map((department) => ({
      value: department.id,
      label: department.name,
      icon: <ColorDot color={department.color} />,
    }));

  const managerHasDepartment = user?.role === "MANAGER" && Boolean(user.department);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={user ? `Edit ${user.name}` : "Add user"}
      description={
        user ? undefined : "They'll get an email invite to set their own password."
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({});
          save.mutate();
        }}
      >
        <Field label="Full name" htmlFor="user-name" error={errors.name}>
          <Input
            id="user-name"
            value={state.name}
            aria-invalid={Boolean(errors.name)}
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>
        {user ? null : (
          <Field label="Work email" htmlFor="user-email" error={errors.email}>
            <Input
              id="user-email"
              type="email"
              value={state.email}
              aria-invalid={Boolean(errors.email)}
              onChange={(event) => set("email", event.target.value)}
            />
          </Field>
        )}
        <Field
          label="Role"
          htmlFor="user-role"
          hint={managerHasDepartment ? "Change this department's manager before changing this role." : undefined}
        >
          <Select
            id="user-role"
            value={state.role}
            disabled={managerHasDepartment}
            onValueChange={(value) => {
              setState((current) => ({
                ...current,
                role: value as AssignableRole,
                reportsTo: "",
              }));
            }}
            options={ROLE_OPTIONS}
          />
        </Field>
        {state.role === "MANAGER" ? (
          <p className="text-muted text-sm">
            A manager reports to the CEO. Assign their department from the Departments page.
          </p>
        ) : (
          <Field
            label="Department"
            htmlFor="user-department"
            error={errors.departmentId}
            hint={
              user && user.department && state.departmentId !== user.department.id
                ? "Moving someone removes them from their projects. Their past reports stay in the old department."
                : undefined
            }
          >
            <Select
              id="user-department"
              value={state.departmentId || undefined}
              placeholder="Select a department"
              invalid={Boolean(errors.departmentId)}
              onValueChange={(value) =>
                setState((current) => ({ ...current, departmentId: value, reportsTo: "" }))
              }
              options={departmentOptions}
            />
          </Field>
        )}
        {state.role === "TEAM_LEAD" ? (
          <p className="text-muted text-sm">A Team Lead reports to their department&apos;s Manager.</p>
        ) : null}
        {needsLead ? (
          <Field
            label="Reports to"
            htmlFor="user-reports-to"
            error={errors.reportsTo}
            hint={
              !leadsLoading && leads?.length === 0
                ? "This department has no Team Lead yet. Add one first."
                : undefined
            }
          >
            <Select
              id="user-reports-to"
              value={state.reportsTo || undefined}
              placeholder={leadsLoading ? "Loading…" : "Select a Team Lead"}
              disabled={leadsLoading || leads?.length === 0}
              invalid={Boolean(errors.reportsTo)}
              onValueChange={(value) => set("reportsTo", value)}
              options={(leads ?? []).map((lead) => ({ value: lead.id, label: lead.name }))}
            />
          </Field>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : user ? "Save changes" : "Create user"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
