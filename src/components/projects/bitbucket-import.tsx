"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { api } from "@/lib/api-client";
import type { BitbucketImportPreview } from "@/lib/projects/service";
import { PROJECTS_KEY } from "./project-dialogs";

export const BITBUCKET_IMPORT_KEY = ["bitbucket-import"];

/** Remembers what "Not now" was said to, so the offer comes back only when there is something new. */
const DISMISSED_KEY = "getl:bitbucket-import-dismissed";
const SHOWN = 5;

/**
 * For a manager who has connected Bitbucket in Settings: offers to add a project for every
 * repository that doesn't have one yet. Shows nothing when there is nothing to import.
 */
export function BitbucketImportBanner() {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISSED_KEY));
    } catch {
      // Storage is blocked: the offer just isn't remembered.
    }
  }, []);

  const { data } = useQuery({
    queryKey: BITBUCKET_IMPORT_KEY,
    queryFn: () => api<BitbucketImportPreview>("/api/projects/import"),
    // Each look asks Bitbucket, so not on every visit to the page.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const run = useMutation({
    mutationFn: () => api<{ imported: number; remaining: number }>("/api/projects/import", { method: "POST" }),
    onSuccess: async ({ imported, remaining }) => {
      toast.success(
        imported === 0
          ? "Every repository already has a project."
          : `${imported} project${imported === 1 ? "" : "s"} imported from Bitbucket.${remaining > 0 ? ` ${remaining} more to go.` : ""}`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PROJECTS_KEY }),
        queryClient.invalidateQueries({ queryKey: BITBUCKET_IMPORT_KEY }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  if (!data?.connected) return null;

  if (data.error) {
    return (
      <Card className="text-warning-text mb-4 flex items-start gap-3 p-4 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          Your Bitbucket repositories couldn&apos;t be listed. {data.error}{" "}
          <Link href="/settings" className="font-medium underline underline-offset-2">
            Check the connection in Settings
          </Link>
        </p>
      </Card>
    );
  }

  const count = data.repositories.length;
  const signature = data.repositories.join("\n");
  if (count === 0 || dismissed === signature) return null;

  const dismiss = () => {
    setDismissed(signature);
    try {
      window.localStorage.setItem(DISMISSED_KEY, signature);
    } catch {
      // Hidden for this visit only.
    }
  };

  return (
    <Card className="border-primary mb-4 flex flex-wrap items-center justify-between gap-4 p-4" role="region" aria-label="Import projects from Bitbucket">
      <div className="min-w-0">
        <h2 className="font-semibold">Import your projects from Bitbucket?</h2>
        <p className="text-muted mt-1 text-sm">
          {count === 1 ? "1 repository in your Bitbucket account isn't" : `${count} repositories in your Bitbucket account aren't`}{" "}
          in GET List yet: {data.repositories.slice(0, SHOWN).join(", ")}
          {count > SHOWN ? ` and ${count - SHOWN} more` : ""}. Each becomes a project in your department, linked to its
          repository. You can rename them and add people afterwards.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" disabled={run.isPending} onClick={dismiss}>
          Not now
        </Button>
        <Button disabled={run.isPending} onClick={() => run.mutate()}>
          <Download />
          {run.isPending ? "Importing…" : "Yes, import"}
        </Button>
      </div>
    </Card>
  );
}
