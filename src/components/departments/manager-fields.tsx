"use client";

import { useQuery } from "@tanstack/react-query";
import type { FieldErrors, UseFormReturn } from "react-hook-form";
import { Controller } from "react-hook-form";
import { Field, Input } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { UserRow } from "@/lib/users/serialise";
import type { ManagerAssignment } from "@/validators/department";

export const UNASSIGNED_MANAGERS_KEY = ["users", "unassigned-managers"];

type NewManagerErrors = { name?: { message?: string }; email?: { message?: string } };

type ManagerForm = { manager: ManagerAssignment };

/**
 * Shared by Add Department and Change manager: pick a Manager without a department, or create and
 * invite a new one. The two modes have different fields, so the form validates them as a union.
 */
export function ManagerFields<T extends ManagerForm>({
  form,
  errors,
}: {
  form: UseFormReturn<T>;
  errors: FieldErrors<ManagerForm>["manager"];
}) {
  // The generic form can't be narrowed to the manager fields without this view of it.
  const managerForm = form as unknown as UseFormReturn<ManagerForm>;
  const mode = managerForm.watch("manager.mode");

  const { data: managers, isLoading } = useQuery({
    queryKey: UNASSIGNED_MANAGERS_KEY,
    queryFn: () => api<UserRow[]>("/api/users?unassigned=true&active=true&limit=100"),
  });

  const fieldErrors = errors as (NewManagerErrors & { userId?: { message?: string } }) | undefined;

  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">Assign manager</legend>
      <div role="radiogroup" aria-label="Manager source" className="grid grid-cols-2 gap-2">
        {(
          [
            { value: "existing", label: "Existing manager" },
            { value: "new", label: "Invite a new one" },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            onClick={() => {
              // Set the watched path itself: setting the parent object doesn't notify watch().
              managerForm.setValue("manager.mode", option.value);
              managerForm.clearErrors("manager");
            }}
            className={cn(
              "rounded-lg border px-2 py-2 text-sm transition-colors duration-150",
              mode === option.value
                ? "bg-primary text-primary-foreground border-transparent font-semibold"
                : "hover:bg-subtle",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === "existing" ? (
        <Field
          label="Manager"
          htmlFor="manager-user"
          error={fieldErrors?.userId?.message ? "Pick a manager" : undefined}
          hint={
            !isLoading && managers?.length === 0
              ? "Every manager already has a department. Invite a new one instead."
              : "Only managers without a department are listed."
          }
        >
          <Controller
            control={managerForm.control}
            name="manager.userId"
            render={({ field }) => (
              <Select
                id="manager-user"
                value={field.value || undefined}
                onValueChange={field.onChange}
                placeholder={isLoading ? "Loading…" : "Select a manager"}
                disabled={isLoading || managers?.length === 0}
                invalid={Boolean(fieldErrors?.userId)}
                options={(managers ?? []).map((manager) => ({
                  value: manager.id,
                  label: `${manager.name} (${manager.email})`,
                }))}
              />
            )}
          />
        </Field>
      ) : (
        <>
          <Field label="Full name" htmlFor="manager-name" error={fieldErrors?.name?.message}>
            <Input
              id="manager-name"
              aria-invalid={Boolean(fieldErrors?.name)}
              {...managerForm.register("manager.name")}
            />
          </Field>
          <Field
            label="Work email"
            htmlFor="manager-email"
            error={fieldErrors?.email?.message}
            hint="They'll be emailed, and sign in with the Microsoft account that has this address."
          >
            <Input
              id="manager-email"
              type="email"
              aria-invalid={Boolean(fieldErrors?.email)}
              {...managerForm.register("manager.email")}
            />
          </Field>
        </>
      )}
    </fieldset>
  );
}
