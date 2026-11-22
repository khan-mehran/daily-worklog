"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { SyncSetupCommand } from "./sync-setup-command";

/**
 * Shown once, the first time someone who logs tasks opens GET List. It is recorded as seen as soon
 * as it appears, so closing the tab doesn't bring it back. The same steps stay in Settings.
 */
export function SyncSetupPopup({ show }: { show: boolean }) {
  // Not over the Connect button the setup command itself sends people to.
  const blocked = usePathname() === "/connect";
  // Decided once per page load. A later refresh, when it's already recorded as seen, must not close it mid-read.
  const [wanted] = useState(show);
  const [dismissed, setDismissed] = useState(false);
  const open = wanted && !blocked && !dismissed;

  useEffect(() => {
    if (open) api("/api/me/sync-guide", { method: "POST" }).catch(() => {});
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && setDismissed(true)}
      title="Log your day automatically"
      description="Set up the VS Code sync once. After that, your git activity in each project is added to your tasks every day, and you can edit the tasks afterwards."
    >
      <SyncSetupCommand />
      <p className="text-muted mt-4 text-xs">
        This message is shown only once. You can find these steps again in{" "}
        <Link href="/settings" className="text-primary font-medium hover:underline" onClick={() => setDismissed(true)}>
          Settings → VS Code sync
        </Link>
        .
      </p>
    </Dialog>
  );
}
