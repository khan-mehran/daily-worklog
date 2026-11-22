"use client";

import { Copy } from "lucide-react";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const subscribeToNothing = () => () => {};

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied.");
  } catch {
    toast.error("Couldn't copy. Select the text and copy it yourself.");
  }
}

/** The one command that sets up the VS Code daily sync, for this server and the reader's OS. */
export function SyncSetupCommand() {
  // The command depends on the browser's address and OS, so it's only rendered in the browser.
  const inBrowser = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const origin = inBrowser ? window.location.origin : "";
  const isWindows = inBrowser && /Windows/i.test(navigator.userAgent);
  const command = !inBrowser
    ? ""
    : isWindows
      ? `$d="$HOME\\.worklog"; mkdir $d -Force >$null; curl.exe -fsSLo "$d\\worklog-sync.mjs" ${origin}/worklog-sync.mjs; node "$d\\worklog-sync.mjs" --setup --url ${origin}`
      : `mkdir -p ~/.worklog && curl -fsSLo ~/.worklog/worklog-sync.mjs ${origin}/worklog-sync.mjs && node ~/.worklog/worklog-sync.mjs --setup --url ${origin}`;

  return (
    <div className="space-y-3 text-sm">
      <ol className="text-muted list-decimal space-y-1.5 pl-5">
        <li>Open your project in VS Code and open the terminal (Terminal → New Terminal).</li>
        <li>Paste this command{isWindows ? " (PowerShell)" : ""} and press Enter.</li>
        <li>GET List opens in your browser. Press Connect.</li>
      </ol>
      <pre className="bg-subtle min-h-8 overflow-x-auto rounded-md p-2 text-xs">{command}</pre>
      <Button type="button" disabled={!inBrowser} onClick={() => copyText(command)}>
        <Copy /> Copy command
      </Button>
      <p className="text-muted">
        It downloads the sync script, creates your token, links the project to GET List and schedules the daily sync.
        Run it again inside any other project to link that one too.
      </p>
    </div>
  );
}
