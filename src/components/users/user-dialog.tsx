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
import { REPORTS_TO_ROLE, ROLE_LABELS, seesAllDepartments, type Role } from "@/lib/constants";
import type { DepartmentSummary } from "@/lib/departments/service";
import type { UserRow } from "@/lib/users/serialise";
import { approveUserSchema, createUserSchema, updateUserSchema } from "@/validators/user";

/** "create" adds someone before they sign in. "approve" lets in someone who is waiting. */
export type UserDialogMode = "create" | "edit" | "approve";

interface FormState {
  name: string;
  email: string;
  role: Role;
  departmentId: string;
  reportsTo: string;
}

const DEPARTMENT_ROLES = ["MANAGER", "TEAM_LEAD", "DEVELOPER"] as const satisfies readonly Role[];
const NO_DEPARTMENT = "none";

const initialState = (user: UserRow | null, mode: UserDialogMode): FormState => ({
  name: user?.name ?? "",
  email: user?.email ?? "",
  // Someone waiting has no real role yet, so the form starts from the most common one.
  role: user && mode === "edit" ? user.role : "DEVELOPER",
  departmentId: user?.department?.id ?? "",
  reportsTo: user?.reportsTo?.id ?? "",
});

/**
 * Add, edit or approve a user. The server enforces every placement rule. This form only narrows
 * the choices: a Developer picks a Team Lead in their department, a Team Lead goes to their
 * department's Manager, and the Super Admin and CEO sit above the departments.
 */
export function UserDialog({
  user,
  mode,
  canAssignOrgWideRoles,
  open,
  onOpenChange,
}: {
  user: UserRow | null;
  mode: UserDialogMode;
  /** Only a Super Admin can give someone the Super Admin or CEO role. */
  canAssignOrgWideRoles: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<FormState>(() => initialState(user, mode));
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setState(initialState(user, mode));
      setErrors({});
    }
  }, [open, user, mode]);

  const { data: departments, isLoading: departmentsLoading } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api<DepartmentSummary[]>("/api/departments"),
    enabled: open,
  });

  const orgWide = seesAllDepartments(state.role);
  const needsLead = state.role === "DEVELOPER" && Boolean(state.departmentId);
  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ["users", "leads", state.departmentId],
    queryFn: () =>
      api<UserRow[]>(
        `/api/users?role=${REPORTS_TO_ROLE.DEVELOPER}&departmentId=${state.departmentId}&active=true&approval=APPROVED&limit=100`,
      ),
    enabled: open && needsLead,
  });

  /** What the form can't know from the schema alone: which fields this role needs. */
  function missingFields() {
    const missing: Record<string, string> = {};
    if (state.role === "TEAM_LEAD" || state.role === "DEVELOPER") {
      if (!state.departmentId) missing.departmentId = "Choose a department";
      else if (state.role === "DEVELOPER" && !state.reportsTo) missing.reportsTo = "Choose a Team Lead";
    }
    return missing;
  }

  const save = useMutation({
    mutationFn: async () => {
      const placement = {
        role: state.role,
        departmentId: state.role === "MANAGER" || orgWide ? null : state.departmentId || null,
        reportsTo: state.role === "DEVELOPER" ? state.reportsTo || null : null,
      };
      if (mode === "approve" && user) {
        const body = approveUserSchema.parse({
          ...placement,
          // A Manager's department is optional here, and makes them that department's manager.
          departmentId: orgWide ? null : state.departmentId || null,
        });
        return api(`/api/users/${user.id}/approve`, { method: "POST", body });
      }
      if (user) {
        const keepsRole = user.role === state.role;
        const body = updateUserSchema.parse(
          orgWide || state.role === "MANAGER"
            ? keepsRole
              ? { name: state.name }
              : { name: state.name, role: state.role }
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
      toast.success(
        mode === "approve"
          ? `${user?.name} can now sign in.`
          : user
            ? "User updated."
            : "User added. They've been emailed to sign in with Microsoft.",
      );
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
      setErrors(Object.fromEntries(issues.map((issue) => [String(issue.path[0]), issue.message])));
    },
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((current) => ({ ...current, [key]: value }));

  const roleOptions = [
    ...(canAssignOrgWideRoles && mode !== "create" ? (["SUPER_ADMIN", "CEO"] as const) : []),
    ...DEPARTMENT_ROLES,
  ].map((value) => ({ value, label: ROLE_LABELS[value] }));

  const departmentOptions = (departments ?? [])
    .filter((department) => department.status === "Active")
    // The IT department is led by the Super Admin, so nobody can be made its Manager.
    .filter((department) => !(state.role === "MANAGER" && department.ledBySuperAdmin))
    .map((department) => ({
      value: department.id,
      label: department.name,
      icon: <ColorDot color={department.color} />,
    }));

  const managerHasDepartment = mode === "edit" && user?.role === "MANAGER" && Boolean(user.department);
  // While approving, a Manager can be handed a department straight away.
  const managerPicksDepartment = state.role === "MANAGER" && mode === "approve";
  const showDepartment = !orgWide && (state.role !== "MANAGER" || managerPicksDepartment);
  const chosenDepartment = departments?.find((department) => department.id === state.departmentId);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "approve" ? `Approve ${user?.name ?? "user"}` : user ? `Edit ${user.name}` : "Add user"}
      description={
        mode === "approve"
          ? `${user?.email} signed in with Microsoft and is waiting. Choose their role and where they sit.`
          : user
            ? undefined
            : "They'll be emailed, and sign in with the Microsoft account that has this address."
      }
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const missing = missingFields();
          setErrors(missing);
          if (Object.keys(missing).length === 0) save.mutate();
        }}
      >
        {mode === "approve" ? null : (
          <Field label="Full name" htmlFor="user-name" error={errors.name}>
            <Input
              id="user-name"
              value={state.name}
              aria-invalid={Boolean(errors.name)}
              onChange={(event) => set("name", event.target.value)}
            />
          </Field>
        )}
        {mode === "create" ? (
          <Field label="Work email" htmlFor="user-email" error={errors.email}>
            <Input
              id="user-email"
              type="email"
              value={state.email}
              aria-invalid={Boolean(errors.email)}
              onChange={(event) => set("email", event.target.value)}
            />
          </Field>
        ) : null}
        <Field
          label="Role"
          htmlFor="user-role"
          error={errors.role}
          hint={managerHasDepartment ? "Change this department's manager before changing this role." : undefined}
        >
          <Select
            id="user-role"
            value={state.role}
            disabled={managerHasDepartment}
            onValueChange={(value) =>
              setState((current) => ({
                ...current,
                role: value as Role,
                reportsTo: "",
                // A department chosen for one role would silently mean something else for a Manager.
                departmentId: value === "MANAGER" || seesAllDepartments(value as Role) ? "" : current.departmentId,
              }))
            }
            options={roleOptions}
          />
        </Field>
        {orgWide ? (
          <p className="text-muted text-sm">
            {state.role === "SUPER_ADMIN"
              ? "A Super Admin approves sign-ins and manages users and departments. They sit above the departments and see all of them."
              : "The CEO sees every department and gives the final acknowledgement to Managers' weeks. There is one CEO."}
          </p>
        ) : null}
        {state.role === "MANAGER" && !managerPicksDepartment ? (
          <p className="text-muted text-sm">
            A manager reports to the CEO. Assign their department from the Departments page.
          </p>
        ) : null}
        {showDepartment ? (
          <Field
            label={managerPicksDepartment ? "Department to manage (optional)" : "Department"}
            htmlFor="user-department"
            error={errors.departmentId}
            hint={
              managerPicksDepartment
                ? chosenDepartment?.manager
                  ? `${chosenDepartment.manager.name} manages ${chosenDepartment.name} now and will become unassigned.`
                  : "Leave this empty to give them a department later, from the Departments page."
                : mode === "edit" && user?.department && state.departmentId !== user.department.id
                  ? "Moving someone removes them from their projects. Their past reports stay in the old department."
                  : !departmentsLoading && departmentOptions.length === 0
                    ? "There are no departments yet. Close this and use Add department first."
                    : undefined
            }
          >
            <Select
              id="user-department"
              value={state.departmentId || (managerPicksDepartment ? NO_DEPARTMENT : undefined)}
              placeholder={departmentsLoading ? "Loading…" : "Select a department"}
              // An empty list would open as a blank box on top of the hint that explains why.
              disabled={!managerPicksDepartment && departmentOptions.length === 0}
              invalid={Boolean(errors.departmentId)}
              onValueChange={(value) =>
                setState((current) => ({
                  ...current,
                  departmentId: value === NO_DEPARTMENT ? "" : value,
                  reportsTo: "",
                }))
              }
              options={
                managerPicksDepartment
                  ? [{ value: NO_DEPARTMENT, label: "No department yet" }, ...departmentOptions]
                  : departmentOptions
              }
            />
          </Field>
        ) : null}
        {state.role === "TEAM_LEAD" ? (
          <p className="text-muted text-sm">
            {chosenDepartment?.ledBySuperAdmin
              ? `A Team Lead here reports to ${chosenDepartment.manager?.name ?? "the Super Admin"}, the Super Admin. This department has no Manager.`
              : "A Team Lead reports to their department's Manager."}
          </p>
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
            {save.isPending
              ? "Saving…"
              : mode === "approve"
                ? "Approve"
                : user
                  ? "Save changes"
                  : "Add user"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
