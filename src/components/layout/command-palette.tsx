"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { FileText, FolderKanban, LayoutGrid, Plus, Search, User } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { isTyping } from "@/components/tasks/tasks-view";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "@/lib/api-client";
import { paletteVar, type Role } from "@/lib/constants";
import { navItemsFor } from "@/lib/navigation";
import type { SearchResults } from "@/lib/search/service";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  group: string;
  title: string;
  subtitle?: string | null;
  color?: string | null;
  icon: typeof Search;
  href: string;
}

/**
 * Ctrl/Cmd+K opens a palette over pages, actions, projects, people and the person's own tasks.
 * N anywhere opens Add Task. Search results come from the API, under the usual access rules.
 */
export function CommandPalette({ role }: { role: Role }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(query.trim(), 200);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      // The Tasks page handles N itself, so it can open the dialog in place.
      if (
        event.key.toLowerCase() === "n" &&
        !event.metaKey && !event.ctrlKey && !event.altKey &&
        role !== "CEO" &&
        pathname !== "/tasks" &&
        !isTyping(event.target) &&
        !document.querySelector("[role=dialog]")
      ) {
        event.preventDefault();
        router.push("/tasks?new=1");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname, role, router]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api<SearchResults>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2,
  });

  const items = useMemo<Item[]>(() => {
    const needle = query.trim().toLowerCase();
    const pages: Item[] = [
      ...(role === "CEO" ? [] : [{ id: "add-task", group: "Actions", title: "Add task", subtitle: "N", icon: Plus, href: "/tasks?new=1" }]),
      ...navItemsFor(role).map((item) => ({ id: item.href, group: "Pages", title: item.label, icon: LayoutGrid, href: item.href })),
    ].filter((item) => !needle || item.title.toLowerCase().includes(needle));
    if (!data || debounced.length < 2) return pages;
    return [
      ...pages,
      ...data.projects.map((item) => ({ ...item, group: "Projects", icon: FolderKanban })),
      ...data.people.map((item) => ({ ...item, group: "People", icon: User })),
      ...data.tasks.map((item) => ({ ...item, group: "Your tasks", icon: FileText })),
    ];
  }, [data, debounced, query, role]);

  useEffect(() => setActive(0), [items.length, query]);

  function go(item: Item | undefined) {
    if (!item) return;
    setOpen(false);
    setQuery("");
    router.push(item.href);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="bg-surface fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border"
        >
          <DialogPrimitive.Title className="sr-only">Search WorkLog</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b px-4">
            <Search className="text-muted size-4" aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls="palette-results"
              aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined}
              aria-label="Search projects, people, tasks and pages"
              placeholder="Search projects, people, tasks and pages"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((index) => Math.min(index + 1, items.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  go(items[active]);
                }
              }}
              className="h-12 flex-1 bg-transparent text-sm outline-none"
            />
            <kbd className="text-muted rounded border px-1.5 text-[10px]">Esc</kbd>
          </div>
          <ul id="palette-results" role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto p-2">
            {items.length === 0 ? (
              <li className="text-muted p-4 text-center text-sm">{isFetching ? "Searching…" : "No matches."}</li>
            ) : (
              items.map((item, index) => {
                const Icon = item.icon;
                const firstOfGroup = index === 0 || items[index - 1]!.group !== item.group;
                return (
                  <li key={`${item.group}-${item.id}`} role="presentation">
                    {firstOfGroup ? (
                      <p className="text-muted px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide uppercase">{item.group}</p>
                    ) : null}
                    <div
                      id={`palette-${item.id}`}
                      role="option"
                      aria-selected={index === active}
                      onMouseMove={() => setActive(index)}
                      onClick={() => go(item)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm",
                        index === active && "bg-subtle",
                      )}
                    >
                      {item.color ? (
                        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: paletteVar(item.color) }} />
                      ) : (
                        <Icon className="text-muted size-4 shrink-0" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {item.subtitle ? <span className="text-muted text-xs">{item.subtitle}</span> : null}
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
