import { CheckCircle2, CirclePause, CirclePlay } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import type { ProjectStatus } from "@/lib/constants";

const STATUS_STYLES: Record<ProjectStatus, { className: string; icon: typeof CirclePlay }> = {
  Active: { className: "text-success-text", icon: CirclePlay },
  "On hold": { className: "text-warning-text", icon: CirclePause },
  Completed: { className: "text-muted", icon: CheckCircle2 },
};

export function ProjectStatusBadge({ status }: { status: string }) {
  const { className, icon: Icon } = STATUS_STYLES[status as ProjectStatus];
  return (
    <Badge className={className}>
      <Icon className="size-3" aria-hidden />
      {status}
    </Badge>
  );
}
