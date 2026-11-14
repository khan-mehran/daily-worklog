"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { api } from "@/lib/api-client";
import type { PaletteColor } from "@/lib/constants";
import {
  createDepartmentSchema,
  managerAssignmentSchema,
  updateDepartmentSchema,
  type ManagerAssignment,
} from "@/validators/department";
import { ManagerFields, UNASSIGNED_MANAGERS_KEY } from "./manager-fields";

export const DEPARTMENTS_KEY = ["departments"];

type CreateInput = z.input<typeof createDepartmentSchema>;
type CreateOutput = z.output<typeof createDepartmentSchema>;

function useRefreshDepartments() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: DEPARTMENTS_KEY }),
      queryClient.invalidateQueries({ queryKey: UNASSIGNED_MANAGERS_KEY }),
      queryClient.invalidateQueries({ queryKey: ["users"] }),
    ]);
    // The top bar's switcher is rendered by the server layout.
    router.refresh();
  };
}

export function AddDepartmentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshDepartments();
  const form = useForm<CreateInput, unknown, CreateOutput>({
    resolver: zodResolver(createDepartmentSchema),
    defaultValues: {
      name: "",
      code: "",
      description: "",
      color: "teal",
      manager: { mode: "existing", userId: "" },
    },
  });
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  async function onSubmit(values: CreateOutput) {
    try {
      await api("/api/departments", { method: "POST", body: values });
      toast.success(`${values.name} created. Its manager has been notified.`);
      await refresh();
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add department"
      description="Every department has one manager, who sees only that department."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Department name" htmlFor="department-name" error={errors.name?.message}>
            <Input id="department-name" aria-invalid={Boolean(errors.name)} {...register("name")} />
          </Field>
          <Field label="Code" htmlFor="department-code" error={errors.code?.message}>
            <Input
              id="department-code"
              className="uppercase"
              placeholder="OPS"
              aria-invalid={Boolean(errors.code)}
              {...register("code")}
            />
          </Field>
        </div>
        <Field
          label="Description"
          htmlFor="department-description"
          error={errors.description?.message}
        >
          <Textarea id="department-description" {...register("description")} />
        </Field>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Colour</p>
          <Controller
            control={control}
            name="color"
            render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />}
          />
        </div>
        <ManagerFields form={form} errors={errors.manager} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create department"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type EditInput = z.input<typeof updateDepartmentSchema>;

export function EditDepartmentDialog({
  department,
  open,
  onOpenChange,
}: {
  department: { id: string; name: string; code: string; description: string; color: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshDepartments();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditInput>({
    resolver: zodResolver(updateDepartmentSchema),
    values: {
      name: department.name,
      code: department.code,
      description: department.description,
      color: department.color as PaletteColor,
    },
  });

  async function onSubmit(values: EditInput) {
    try {
      await api(`/api/departments/${department.id}`, { method: "PATCH", body: values });
      toast.success("Department updated.");
      await refresh();
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Edit ${department.name}`}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Department name" htmlFor="edit-name" error={errors.name?.message}>
            <Input id="edit-name" aria-invalid={Boolean(errors.name)} {...register("name")} />
          </Field>
          <Field label="Code" htmlFor="edit-code" error={errors.code?.message}>
            <Input
              id="edit-code"
              className="uppercase"
              aria-invalid={Boolean(errors.code)}
              {...register("code")}
            />
          </Field>
        </div>
        <Field label="Description" htmlFor="edit-description" error={errors.description?.message}>
          <Textarea id="edit-description" {...register("description")} />
        </Field>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Colour</p>
          <Controller
            control={control}
            name="color"
            render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ChangeManagerDialog({
  departmentId,
  departmentName,
  open,
  onOpenChange,
}: {
  departmentId: string;
  departmentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshDepartments();
  const form = useForm<{ manager: ManagerAssignment }>({
    defaultValues: { manager: { mode: "existing", userId: "" } },
  });
  const { handleSubmit, reset, setError, formState } = form;

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  async function onSubmit({ manager }: { manager: ManagerAssignment }) {
    const parsed = managerAssignmentSchema.safeParse(manager);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as "userId" | "name" | "email";
        setError(`manager.${field}`, { message: issue.message });
      }
      return;
    }
    try {
      await api(`/api/departments/${departmentId}/manager`, { method: "POST", body: parsed.data });
      toast.success("Manager changed. Team leads and open reviews moved across.");
      await refresh();
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Change manager of ${departmentName}`}
      description="Team leads and open reviews move to the new manager. The previous manager becomes unassigned."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <ManagerFields form={form} errors={formState.errors.manager} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? "Saving…" : "Change manager"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
