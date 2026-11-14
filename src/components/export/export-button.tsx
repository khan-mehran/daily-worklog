"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useDateRange } from "@/components/layout/date-range";
import { MemberPicker, type PickerPerson } from "@/components/projects/member-picker";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { ColorDot } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { REPORT_STATUS_LABELS, REPORT_STATUSES, type Role } from "@/lib/constants";
import type { ProjectSummary } from "@/lib/projects/service";

async function download(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "The export failed. Please try again.");
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "worklog.xlsx";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await response.blob());
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Export to Excel, with the filters from the brief. The server limits what any filter can reach. */
export function ExportButton({ role }: { role: Role }) {
  const { range } = useDateRange();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [people, setPeople] = useState<PickerPerson[]>([]);
  const [projectId, setProjectId] = useState("all");
  const [status, setStatus] = useState("all");
  const [pending, setPending] = useState(false);

  const { data: projects } = useQuery({
    queryKey: ["projects", "export"],
    queryFn: () => api<ProjectSummary[]>("/api/projects?limit=100"),
    enabled: open,
  });

  async function onExport() {
    const params = new URLSearchParams({ from, to });
    if (people.length) params.set("userIds", people.map((person) => person.id).join(","));
    if (projectId !== "all") params.set("projectId", projectId);
    if (status !== "all") params.set("status", status);
    setPending(true);
    try {
      await download(`/api/export/tasks?${params}`);
      toast.success("Export downloaded.");
      setOpen(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setFrom(range.from);
          setTo(range.to);
          setOpen(true);
        }}
      >
        <FileSpreadsheet />
        Export to Excel
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Export to Excel"
        description={
          role === "CEO"
            ? "Fully approved work. Use the department switcher to export one department."
            : "Work in your department that has reached you."
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="export-from">
              <Input id="export-from" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="To" htmlFor="export-to">
              <Input id="export-to" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project" htmlFor="export-project">
              <Select
                id="export-project"
                value={projectId}
                onValueChange={setProjectId}
                options={[
                  { value: "all", label: "All projects" },
                  ...(projects ?? []).map((project) => ({
                    value: project.id,
                    label: project.name,
                    icon: <ColorDot color={project.color} />,
                  })),
                ]}
              />
            </Field>
            <Field label="Report status" htmlFor="export-status">
              <Select
                id="export-status"
                value={status}
                onValueChange={setStatus}
                options={[
                  { value: "all", label: "Any status" },
                  ...REPORT_STATUSES.map((value) => ({ value, label: REPORT_STATUS_LABELS[value] })),
                ]}
              />
            </Field>
          </div>
          <MemberPicker selected={people} onChange={setPeople} />
          <p className="text-muted text-xs">Leave members empty to include everyone you can see.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || !from || !to} onClick={onExport}>
              <Download />
              {pending ? "Preparing…" : "Download .xlsx"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
