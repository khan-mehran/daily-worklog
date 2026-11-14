"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { api } from "@/lib/api-client";

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const TOKENS_KEY = ["me", "tokens"];
const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied.");
  } catch {
    toast.error("Couldn't copy. Select the text and copy it yourself.");
  }
}

/** Personal API tokens and setup steps for the VS Code daily sync. */
export function VsCodeSyncSection() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("My laptop");
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<TokenRow | null>(null);

  const tokens = useQuery({ queryKey: TOKENS_KEY, queryFn: () => api<TokenRow[]>("/api/me/tokens") });
  const create = useMutation({
    mutationFn: () => api<{ id: string; token: string }>("/api/me/tokens", { method: "POST", body: { name } }),
    onSuccess: ({ token }) => {
      setCreated(token);
      queryClient.invalidateQueries({ queryKey: TOKENS_KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/me/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Token revoked.");
      setRevoking(null);
      queryClient.invalidateQueries({ queryKey: TOKENS_KEY });
    },
    onError: (error) => toast.error(error.message),
  });

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const configJson = JSON.stringify(
    { url: origin, token: created ?? "wlk_…", scan: ["D:/Projects"], repos: [] },
    null,
    2,
  );

  return (
    <div className="space-y-5 text-sm">
      <ol className="text-muted list-decimal space-y-1.5 pl-5">
        <li>
          Download{" "}
          <a className="text-primary font-medium underline-offset-2 hover:underline" href="/worklog-sync.mjs" download>
            worklog-sync.mjs
          </a>{" "}
          and save it in your home folder, under <code>.worklog</code>.
        </li>
        <li>Create a token below and put it in <code>~/.worklog/config.json</code>.</li>
        <li>
          In each repo, add <code>.worklog.json</code> containing <code>{`{ "project": "CODE" }`}</code>, using the
          project&apos;s code from the Projects page.
        </li>
        <li>
          Run <code>node ~/.worklog/worklog-sync.mjs --install</code> once. It then syncs every day at 6 PM.
        </li>
        <li>
          For the best write-up, type <code>/worklog</code> in Claude Code at the end of the day. Claude reads your
          changes and sends a work list. Your code stays on your machine.
        </li>
      </ol>

      {created ? (
        <div className="border-primary bg-primary/5 space-y-2 rounded-lg border p-3">
          <p className="font-medium">Copy your token now. It won&apos;t be shown again.</p>
          <div className="flex gap-2">
            <Input readOnly value={created} className="font-mono text-xs" onFocus={(event) => event.target.select()} />
            <Button type="button" variant="secondary" size="icon" aria-label="Copy token" onClick={() => copy(created)}>
              <Copy />
            </Button>
          </div>
          <p className="text-muted">Your config.json:</p>
          <pre className="bg-subtle overflow-x-auto rounded-md p-2 text-xs">{configJson}</pre>
          <Button type="button" variant="secondary" size="sm" onClick={() => copy(configJson)}>
            <Copy /> Copy config
          </Button>
        </div>
      ) : (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="flex-1">
            <Field label="Token name" htmlFor="token-name">
              <Input id="token-name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
            </Field>
          </div>
          <Button type="submit" disabled={create.isPending || name.trim() === ""}>
            <KeyRound /> Create token
          </Button>
        </form>
      )}

      {tokens.data && tokens.data.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {tokens.data.map((token) => (
            <li key={token.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{token.name}</span>
                <span className="text-muted block text-xs">
                  <code>{token.prefix}…</code> · created {formatDate(token.createdAt)} ·{" "}
                  {token.lastUsedAt ? `last used ${formatDate(token.lastUsedAt)}` : "never used"}
                </span>
              </span>
              <Button variant="ghost" size="icon" aria-label={`Revoke ${token.name}`} onClick={() => setRevoking(token)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <a className="text-muted inline-flex items-center gap-1.5 text-xs hover:underline" href="/worklog-sync.mjs" download>
        <Download className="size-3.5" aria-hidden /> worklog-sync.mjs
      </a>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke this token?"
        description={`The sync on "${revoking?.name ?? ""}" stops working until you give it a new token.`}
        confirmLabel="Revoke"
        danger
        pending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </div>
  );
}
