"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Download, Send, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useRefreshWork } from "@/components/tasks/use-tasks";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { api } from "@/lib/api-client";
import type { ReportDetail } from "@/lib/reports/service";

export function RequestChangesDialog({
  open,
  onOpenChange,
  ownerName,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerName: string;
  onSubmit: (comment: string) => void;
  pending: boolean;
}) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setComment("");
          setError(null);
        }
        onOpenChange(next);
      }}
      title="Request changes"
      description={`The week goes back to ${ownerName}, whose tasks unlock so they can fix and resubmit.`}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (comment.trim().length < 3) {
            setError("Say what needs to change.");
            return;
          }
          onSubmit(comment.trim());
        }}
      >
        <Field label="What needs to change?" htmlFor="changes-comment" error={error ?? undefined}>
          <Textarea
            id="changes-comment"
            rows={4}
            autoFocus
            maxLength={1000}
            value={comment}
            aria-invalid={Boolean(error)}
            onChange={(event) => setComment(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            <Undo2 />
            {pending ? "Sending…" : "Send back"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The buttons a viewer gets on a report: review actions, submit, or download for the owner. */
export function ReportActions({ report }: { report: ReportDetail }) {
  const router = useRouter();
  const refresh = useRefreshWork();
  const [dialog, setDialog] = useState<"approve" | "changes" | "submit" | null>(null);

  const act = useMutation({
    mutationFn: ({ action, comment }: { action: "approve" | "submit" | "request-changes"; comment?: string }) =>
      api(`/api/reports/${report.id}/${action}`, {
        method: "POST",
        body: comment === undefined ? undefined : { comment },
      }),
    onSuccess: async (_data, { action }) => {
      setDialog(null);
      toast.success(
        action === "approve"
          ? "Done. The report moved on, and the next person has been notified."
          : action === "submit"
            ? "Week submitted. Your approver has been notified."
            : `Sent back to ${report.owner?.name}.`,
      );
      await refresh();
      // A week sent back is the owner's draft again, which reviewers can't open, so they return
      // to their inbox. Other actions leave the report visible, so the page just updates.
      if (action === "request-changes") router.push("/reviews");
      else router.refresh();
    },
    onError: (error) => {
      setDialog(null);
      toast.error(error.message);
    },
  });

  const owner = report.owner?.name ?? "the owner";
  return (
    <div className="flex flex-wrap gap-2">
      {report.permissions.isOwner ? (
        <Button variant="secondary" asChild>
          <a href={`/api/reports/${report.id}/export`} download>
            <Download />
            Download Excel
          </a>
        </Button>
      ) : null}
      {report.permissions.canSubmit ? (
        <Button onClick={() => setDialog("submit")}>
          <Send />
          Submit week
        </Button>
      ) : null}
      {report.permissions.canReview ? (
        <>
          <Button variant="secondary" onClick={() => setDialog("changes")}>
            <Undo2 />
            Request changes
          </Button>
          <Button onClick={() => setDialog("approve")}>
            <Check />
            Done
          </Button>
        </>
      ) : null}

      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(open) => setDialog(open ? "approve" : null)}
        title={`Approve ${owner}'s week ${report.isoWeek}?`}
        description={
          report.status === "SUBMITTED" && report.owner?.role === "DEVELOPER"
            ? "It goes to the Manager for final approval."
            : report.owner?.role === "MANAGER"
              ? "This acknowledges the Manager's week."
              : "This is the final approval. The week becomes visible to the CEO."
        }
        confirmLabel="Done"
        pending={act.isPending}
        onConfirm={() => act.mutate({ action: "approve" })}
      />
      <ConfirmDialog
        open={dialog === "submit"}
        onOpenChange={(open) => setDialog(open ? "submit" : null)}
        title={`Submit week ${report.isoWeek}?`}
        description="Your tasks for this week will be locked and sent to your approver."
        confirmLabel="Submit week"
        pending={act.isPending}
        onConfirm={() => act.mutate({ action: "submit" })}
      />
      <RequestChangesDialog
        open={dialog === "changes"}
        onOpenChange={(open) => setDialog(open ? "changes" : null)}
        ownerName={owner}
        pending={act.isPending}
        onSubmit={(comment) => act.mutate({ action: "request-changes", comment })}
      />
    </div>
  );
}
