"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Pencil, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { wordDiff, type DiffPart } from "@/lib/word-diff";

export const AI_MAX_CHARS = 1000;

function DiffText({ parts, label }: { parts: DiffPart[]; label: string }) {
  return (
    <div className="bg-surface min-w-0 rounded-lg border p-3">
      <p className="text-muted mb-1.5 text-xs font-semibold tracking-wide uppercase">{label}</p>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">
        {parts.map((part, index) => (
          <span
            key={index}
            className={cn(
              part.kind === "removed" && "text-accent-text line-through decoration-2",
              part.kind === "added" && "bg-primary/15 rounded-sm font-medium",
            )}
          >
            {part.text}
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * "Improve with AI": sends the draft to the server, then shows the original and the rewrite side
 * by side. Nothing changes until the person accepts, and a failure never blocks saving.
 */
export function AiImprove({
  text,
  onUse,
}: {
  text: string;
  /** Called with the rewrite. `edit` means the person wants to keep editing it. */
  onUse: (improved: string, mode: "accept" | "edit") => void;
}) {
  const improve = useMutation({
    mutationFn: (draft: string) =>
      api<{ text: string }>("/api/ai/improve", { method: "POST", body: { text: draft } }),
  });

  const trimmed = text.trim();
  const tooLong = trimmed.length > AI_MAX_CHARS;
  const result = improve.data && improve.variables === trimmed ? improve.data.text : null;
  const diff = result ? wordDiff(trimmed, result) : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={trimmed.length < 3 || tooLong || improve.isPending}
          onClick={() => improve.mutate(trimmed)}
        >
          <Sparkles />
          {improve.isPending ? "Improving…" : "Improve with AI"}
        </Button>
        {tooLong ? (
          <span className="text-muted text-xs">AI works on up to {AI_MAX_CHARS} characters.</span>
        ) : null}
      </div>

      {improve.isError ? (
        <p role="alert" className="bg-subtle rounded-lg px-3 py-2 text-sm">
          {improve.error.message} You can still save what you wrote.
        </p>
      ) : null}

      {diff && result ? (
        <div className="bg-subtle space-y-3 rounded-lg p-3" aria-live="polite">
          <div className="grid gap-2 sm:grid-cols-2">
            <DiffText parts={diff.before} label="Original" />
            <DiffText parts={diff.after} label="Improved" />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => improve.reset()}>
              <X />
              Discard
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onUse(result, "edit");
                improve.reset();
              }}
            >
              <Pencil />
              Edit
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onUse(result, "accept");
                improve.reset();
              }}
            >
              <Check />
              Accept
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
