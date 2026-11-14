import { NotebookPen } from "lucide-react";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-lg font-bold">
        <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
          <NotebookPen className="size-5" aria-hidden />
        </span>
        WorkLog
      </div>
      <div className="bg-surface w-full max-w-sm rounded-xl border p-6">{children}</div>
    </main>
  );
}
