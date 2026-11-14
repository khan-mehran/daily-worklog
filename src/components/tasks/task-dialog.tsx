"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { ColorDot } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { TASK_STATUSES } from "@/lib/constants";
import type { MyTask } from "@/lib/tasks/service";
import { createTaskSchema } from "@/validators/task";
import { AiImprove } from "./ai-improve";
import { useLoggableProjects, useRefreshWork } from "./use-tasks";

type FormInput = z.input<typeof createTaskSchema>;
type FormOutput = z.output<typeof createTaskSchema>;

interface Template {
  id: string;
  details: string;
  hours: number | null;
  project: { id: string; name: string; color: string };
}

/**
 * Add Task, or edit one when `task` is given. Project and details are required. Hours, status
 * and date are optional, with today and Completed as defaults, so a quick entry is two fields.
 */
export function TaskDialog({
  open,
  onOpenChange,
  date,
  task,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  task?: MyTask;
}) {
  const refresh = useRefreshWork();
  const queryClient = useQueryClient();
  const detailsRef = useRef<HTMLTextAreaElement | null>(null);
  const [saveTemplate, setSaveTemplate] = useState(false);
  const { data: projects, isLoading: projectsLoading } = useLoggableProjects(open);
  const { data: templates } = useQuery({
    queryKey: ["task-templates"],
    queryFn: () => api<Template[]>("/api/task-templates"),
    enabled: open && !task,
  });

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(createTaskSchema) });

  useEffect(() => {
    if (!open) return;
    setSaveTemplate(false);
    reset({
      projectId: task?.project.id ?? "",
      details: task?.details ?? "",
      hours: task?.hours ?? "",
      status: (task?.status as FormInput["status"]) ?? "Completed",
      date: task?.date ?? date,
    });
  }, [open, task, date, reset]);

  const { ref: detailsFieldRef, ...detailsField } = register("details");

  async function onSubmit(values: FormOutput) {
    try {
      if (task) {
        await api(`/api/tasks/${task.id}`, { method: "PATCH", body: values });
        toast.success("Task updated.");
      } else {
        await api("/api/tasks", { method: "POST", body: values });
        if (saveTemplate) {
          await api("/api/task-templates", {
            method: "POST",
            body: { projectId: values.projectId, details: values.details, hours: values.hours },
          }).catch((error: Error) => toast.error(`Task saved, but not the template: ${error.message}`));
          await queryClient.invalidateQueries({ queryKey: ["task-templates"] });
        }
        toast.success("Task added.");
      }
      await refresh();
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  const projectOptions = (projects ?? []).map((project) => ({
    value: project.id,
    label: project.name,
    icon: <ColorDot color={project.color} />,
  }));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={task ? "Edit task" : "Add task"}
      description={task ? undefined : "Only project and details are required."}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {!task && templates && templates.length > 0 ? (
          <Field label="Start from a template" htmlFor="task-template">
            <Select
              id="task-template"
              placeholder="Choose a template"
              onValueChange={(id) => {
                const template = templates.find((item) => item.id === id);
                if (!template) return;
                setValue("projectId", template.project.id, { shouldValidate: true });
                setValue("details", template.details, { shouldValidate: true });
                setValue("hours", template.hours ?? "");
              }}
              options={templates.map((template) => ({
                value: template.id,
                label: `${template.project.name}: ${template.details.slice(0, 50)}`,
                icon: <ColorDot color={template.project.color} />,
              }))}
            />
          </Field>
        ) : null}

        <Field
          label="Project"
          htmlFor="task-project"
          error={errors.projectId ? "Choose a project" : undefined}
          hint={
            !projectsLoading && projectOptions.length === 0
              ? "You're not on any active projects. Ask your Team Lead to assign you."
              : undefined
          }
        >
          <Controller
            control={control}
            name="projectId"
            render={({ field }) => (
              <Select
                id="task-project"
                value={field.value || undefined}
                onValueChange={field.onChange}
                placeholder={projectsLoading ? "Loading…" : "Choose a project"}
                disabled={projectsLoading || projectOptions.length === 0}
                invalid={Boolean(errors.projectId)}
                options={projectOptions}
              />
            )}
          />
        </Field>

        <Field label="Task details" htmlFor="task-details" error={errors.details?.message}>
          <Textarea
            id="task-details"
            rows={4}
            placeholder="What did you work on?"
            aria-invalid={Boolean(errors.details)}
            {...detailsField}
            ref={(element) => {
              detailsFieldRef(element);
              detailsRef.current = element;
            }}
          />
        </Field>
        <AiImprove
          text={watch("details") ?? ""}
          onUse={(improved, mode) => {
            setValue("details", improved, { shouldValidate: true, shouldDirty: true });
            if (mode === "edit") detailsRef.current?.focus();
          }}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Hours" htmlFor="task-hours" error={errors.hours?.message} hint="Optional">
            <Input
              id="task-hours"
              type="number"
              inputMode="decimal"
              min={0.25}
              max={24}
              step={0.25}
              aria-invalid={Boolean(errors.hours)}
              {...register("hours", {
                setValueAs: (value: string) => (value === "" ? "" : Number(value)),
              })}
            />
          </Field>
          <Field label="Status" htmlFor="task-status">
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select
                  id="task-status"
                  value={field.value}
                  onValueChange={field.onChange}
                  options={TASK_STATUSES.map((value) => ({ value, label: value }))}
                />
              )}
            />
          </Field>
          <Field label="Date" htmlFor="task-date" error={errors.date?.message}>
            <Input id="task-date" type="date" aria-invalid={Boolean(errors.date)} {...register("date")} />
          </Field>
        </div>

        {task ? null : (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary size-4"
              checked={saveTemplate}
              onChange={(event) => setSaveTemplate(event.target.checked)}
            />
            Also save as a template
          </label>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : task ? "Save changes" : "Add task"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
