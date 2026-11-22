"use client";

import { useMutation } from "@tanstack/react-query";
import { Laptop } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api-client";

interface Props {
  /** Where the setup script is listening. Null when the link is incomplete. */
  target: { port: number; state: string } | null;
  name: string;
}

/** Creates a sync token and hands it to the setup script waiting on this computer. */
export function ConnectDevice({ target, name }: Props) {
  const form = useRef<HTMLFormElement>(null);
  const tokenInput = useRef<HTMLInputElement>(null);
  const connect = useMutation({
    mutationFn: () => api<{ token: string }>("/api/me/tokens", { method: "POST", body: { name } }),
    onSuccess: ({ token }) => {
      if (!form.current || !tokenInput.current) return;
      tokenInput.current.value = token;
      // A form post, not a link, keeps the token out of the address bar and browser history.
      form.current.submit();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <PageHeader title="Connect this computer" description="Lets the VS Code daily sync add tasks for you." />
      <Card className="max-w-lg space-y-4 p-6 text-sm">
        {target ? (
          <>
            <p>
              The setup command running on <strong>{name}</strong> is asking for a sync token. The token can only
              add your daily tasks. You can revoke it in Settings at any time.
            </p>
            <p className="text-muted">Only continue if you started the setup command yourself.</p>
            <Button type="button" disabled={connect.isPending || connect.isSuccess} onClick={() => connect.mutate()}>
              <Laptop /> Connect
            </Button>
            <form ref={form} method="post" action={`http://127.0.0.1:${target.port}/callback`} hidden>
              <input type="hidden" name="state" value={target.state} readOnly />
              <input ref={tokenInput} type="hidden" name="token" />
            </form>
          </>
        ) : (
          <p>This link is incomplete. Run the setup command again and use the link it opens.</p>
        )}
      </Card>
    </>
  );
}
