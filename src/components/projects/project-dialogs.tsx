"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { PROJECT_STATUSES, type PaletteColor, type ProjectStatus } from "@/lib/constants";
import type { ProjectSummary } from "@/lib/projects/service";
import { createProjectSchema, updateProjectSchema } from "@/validators/project";
import { MemberPicker, type PickerPerson } from "./member-picker";

export const PROJECTS_KEY = ["projects"];

const STATUS_OPTIONS = PROJECT_STATUSES.map((value) => ({ value, label: value }));

type FormInput = z.input<typeof createProjectSchema>;
type FormOutput = z.output<typeof createProjectSchema>;

function useRefreshProjects() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
    // The detail page is rendered by the server.
    router.refresh();
  };
}

/** Add a project, or edit one when `project` is given. Members have their own dialog once it exists. */
export function ProjectDialog({
  project,
  open,
  onOpenChange,
  onCreated,
}: {
  project?: ProjectSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}) {
  const refresh = useRefreshProjects();
  const [members, setMembers] = useState<PickerPerson[]>([]);
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: "", code: "", description: "", color: "teal", status: "Active" },
  });

  useEffect(() => {
    if (!open) return;
    setMembers([]);
    reset({
      name: project?.name ?? "",
      code: project?.code ?? "",
      description: project?.description ?? "",
      color: (project?.color as PaletteColor) ?? "teal",
      status: (project?.status as ProjectStatus) ?? "Active",
      startDate: project?.startDate ?? "",
      endDate: project?.endDate ?? "",
    });
  }, [open, project, reset]);

  async function onSubmit(values: FormOutput) {
    try {
      if (project) {
        // Parsing drops memberIds, which this form doesn't edit for an existing project.
        await api(`/api/projects/${project.id}`, {
          method: "PATCH",
          body: updateProjectSchema.parse(values),
        });
        toast.success("Project updated.");
      } else {
        const created = await api<{ id: string }>("/api/projects", {
          method: "POST",
          body: { ...values, memberIds: members.map((member) => member.id) },
        });
        toast.success(`${values.name} created.`);
        onCreated?.(created.id);
      }
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
      title={project ? `Edit ${project.name}` : "Add project"}
      description={project ? undefined : "It will belong to your department."}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Project name" htmlFor="project-name" error={errors.name?.message}>
            <Input id="project-name" aria-invalid={Boolean(errors.name)} {...register("name")} />
          </Field>
          <Field label="Code" htmlFor="project-code" error={errors.code?.message}>
            <Input
              id="project-code"
              className="uppercase"
              placeholder="PORTAL"
              aria-invalid={Boolean(errors.code)}
              {...register("code")}
            />
          </Field>
        </div>
        <Field label="Description" htmlFor="project-description" error={errors.description?.message}>
          <Textarea id="project-description" {...register("description")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Status" htmlFor="project-status">
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select
                  id="project-status"
                  value={field.value}
                  onValueChange={field.onChange}
                  options={STATUS_OPTIONS}
                />
              )}
            />
          </Field>
          <Field label="Start date" htmlFor="project-start" error={errors.startDate?.message}>
            <Input id="project-start" type="date" {...register("startDate")} />
          </Field>
          <Field label="End date" htmlFor="project-end" error={errors.endDate?.message}>
            <Input
              id="project-end"
              type="date"
              aria-invalid={Boolean(errors.endDate)}
              {...register("endDate")}
            />
          </Field>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Colour</p>
          <Controller
            control={control}
            name="color"
            render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />}
          />
        </div>
        {project ? null : <MemberPicker selected={members} onChange={setMembers} />}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : project ? "Save changes" : "Create project"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ManageMembersDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshProjects();
  const [selected, setSelected] = useState<PickerPerson[]>(project.members);

  useEffect(() => {
    if (open) setSelected(project.members);
  }, [open, project.members]);

  const save = useMutation({
    mutationFn: () => {
      const before = new Set(project.members.map((member) => member.id));
      const after = new Set(selected.map((member) => member.id));
      return api(`/api/projects/${project.id}/members`, {
        method: "POST",
        body: {
          add: [...after].filter((id) => !before.has(id)),
          remove: [...before].filter((id) => !after.has(id)),
        },
      });
    },
    onSuccess: async () => {
      toast.success("Members updated.");
      await refresh();
      onOpenChange(false);
    },
    onError: (error) => toast.error(error.message),
  });

  const changed =
    selected.length !== project.members.length ||
    selected.some((person) => !project.members.some((member) => member.id === person.id));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Members of ${project.name}`}
      description="Developers can only see and log time on projects they're assigned to."
    >
      <div className="space-y-4">
        <MemberPicker selected={selected} onChange={setSelected} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!changed || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save members"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
