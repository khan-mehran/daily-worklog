import { CheckCheck, CircleCheck, CircleDashed, Send, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { REPORT_STATUS_LABELS, type ReportStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

// Each state has its own icon as well as its colour, so it never relies on colour alone.
const STYLES: Record<ReportStatus, { className: string; icon: typeof Send }> = {
  DRAFT: { className: "text-muted", icon: CircleDashed },
  SUBMITTED: { className: "text-info border-info/40", icon: Send },
  LEAD_APPROVED: { className: "text-primary border-primary/40", icon: CircleCheck },
  MANAGER_APPROVED: { className: "text-success-text border-success/40", icon: CheckCheck },
  CHANGES_REQUESTED: { className: "text-accent-text border-accent/50", icon: Undo2 },
};

export function ReportStatusBadge({ status, className }: { status: ReportStatus; className?: string }) {
  const { className: tone, icon: Icon } = STYLES[status];
  return (
    <Badge className={cn(tone, className)}>
      <Icon className="size-3" aria-hidden />
      {REPORT_STATUS_LABELS[status]}
    </Badge>
  );
}
