"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { BITBUCKET_IMPORT_KEY } from "@/components/projects/bitbucket-import";
import { api } from "@/lib/api-client";
import type { BitbucketConnectionView } from "@/lib/bitbucket/connection";

/**
 * The department's Bitbucket account, for its manager. The token is write-only: once saved it is
 * encrypted on the server and never comes back to this page.
 */
export function BitbucketSection({ initial }: { initial: BitbucketConnectionView }) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState(initial);
  const [username, setUsername] = useState(initial.connected ? (initial.username ?? "") : "");
  const [workspace, setWorkspace] = useState(initial.connected ? (initial.workspace ?? "") : "");
  const [token, setToken] = useState("");
  const [removing, setRemoving] = useState(false);

  const needsToken = !connection.connected || !connection.readable;
  const refreshImport = () => queryClient.invalidateQueries({ queryKey: BITBUCKET_IMPORT_KEY });

  const save = useMutation({
    mutationFn: () =>
      api<BitbucketConnectionView>("/api/bitbucket/connection", {
        method: "PUT",
        body: { username, workspace, ...(token ? { token } : {}) },
      }),
    onSuccess: async (saved) => {
      setConnection(saved);
      setToken("");
      toast.success("Bitbucket connected. Open Projects to import your repositories.");
      await refreshImport();
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: () => api("/api/bitbucket/connection", { method: "DELETE" }),
    onSuccess: async () => {
      setConnection({ connected: false });
      setUsername("");
      setWorkspace("");
      setToken("");
      setRemoving(false);
      toast.success("Bitbucket disconnected.");
      await refreshImport();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (needsToken && !token.trim()) {
          toast.error("Enter a Bitbucket token.");
          return;
        }
        save.mutate();
      }}
    >
      {connection.connected ? (
        connection.readable ? (
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="text-success-text size-4 shrink-0" aria-hidden />
            <span>
              Connected{connection.username ? ` as ${connection.username}` : ""}.{" "}
              <Link href="/projects" className="text-primary font-medium underline-offset-2 hover:underline">
                Import projects
              </Link>
            </span>
          </p>
        ) : (
          <p className="text-warning-text flex items-center gap-2 text-sm">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            The saved token can&apos;t be read any more. Enter it again.
          </p>
        )
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Field
          label="Username"
          htmlFor="bitbucket-username"
          hint="For an API token, your Atlassian account's email address. Leave empty for an access token."
        >
          <Input
            id="bitbucket-username"
            autoComplete="off"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <Field
          label="Token"
          htmlFor="bitbucket-token"
          hint={
            needsToken
              ? "Needs read access to workspaces and repositories. It is stored encrypted and never shown again."
              : "Saved and encrypted. Leave empty to keep it, or enter a new one to replace it."
          }
        >
          <Input
            id="bitbucket-token"
            type="password"
            autoComplete="new-password"
            placeholder={needsToken ? "" : "••••••••••••"}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </Field>
        <Field
          label="Workspaces"
          htmlFor="bitbucket-workspace"
          hint="Optional. Import only from these workspaces: one ID, or several separated by commas. Empty means every workspace you belong to."
        >
          <Input
            id="bitbucket-workspace"
            autoComplete="off"
            spellCheck={false}
            placeholder="workspace-one, workspace-two"
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Checking with Bitbucket…" : connection.connected ? "Save" : "Connect Bitbucket"}
        </Button>
        {connection.connected ? (
          <Button variant="secondary" onClick={() => setRemoving(true)}>
            Disconnect
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Disconnect Bitbucket?"
        description="The saved token is deleted. Projects you imported stay, but their dependencies are no longer checked with this account."
        confirmLabel="Disconnect"
        danger
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </form>
  );
}
