import { ListChecks } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ExportButton } from "@/components/export/export-button";
import { TasksView } from "@/components/tasks/tasks-view";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { requirePageUser } from "@/lib/auth/page";
import { ROLE_LABELS, seesAllDepartments } from "@/lib/constants";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage() {
  const user = await requirePageUser();
  const canExport = user.role !== "DEVELOPER";

  // The CEO and Super Admin don't log work, so their Tasks page is the export.
  if (seesAllDepartments(user.role)) {
    return (
      <>
        <PageHeader
          title="Tasks"
          description="Export fully approved work across departments, or one department with the switcher."
          actions={<ExportButton role={user.role} />}
        />
        <Card>
          <EmptyState
            icon={ListChecks}
            title={`The ${ROLE_LABELS[user.role]} doesn't log tasks`}
            description="Approved work from every department is in the dashboard, on project pages and in the Excel export."
          />
        </Card>
      </>
    );
  }
  return (
    <Suspense>
      <TasksView exportSlot={canExport ? <ExportButton role={user.role} /> : undefined} />
    </Suspense>
  );
}
