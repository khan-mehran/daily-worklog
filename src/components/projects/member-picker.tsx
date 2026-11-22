"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/form";
import { Avatar, Skeleton } from "@/components/ui/misc";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "@/lib/api-client";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import type { UserRow } from "@/lib/users/serialise";

export interface PickerPerson {
  id: string;
  name: string;
  role: string;
  avatarColor: string;
}

/**
 * Multi-select with server-side search. The API only returns the caller's own department, so
 * people from other departments can't be offered here. A Super Admin sees every department, so
 * `departmentId` narrows the list to the project's own.
 */
export function MemberPicker({
  selected,
  onChange,
  departmentId,
}: {
  departmentId?: string | null;
  selected: PickerPerson[];
  onChange: (people: PickerPerson[]) => void;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search);
  const params = new URLSearchParams({ active: "true", approval: "APPROVED", limit: "50" });
  if (departmentId) params.set("departmentId", departmentId);
  if (debounced) params.set("search", debounced);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["users", "member-picker", departmentId ?? null, debounced],
    queryFn: () => api<UserRow[]>(`/api/users?${params}`),
  });

  const selectedIds = new Set(selected.map((person) => person.id));
  const toggle = (person: PickerPerson) =>
    onChange(
      selectedIds.has(person.id)
        ? selected.filter((item) => item.id !== person.id)
        : [...selected, person],
    );

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">
        Members <span className="text-muted font-normal">({selected.length})</span>
      </legend>
      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => toggle(person)}
                aria-label={`Remove ${person.name}`}
                className="hover:bg-subtle inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150"
              >
                {person.name}
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative">
        <Search className="text-muted absolute top-3 left-3 size-4" aria-hidden />
        <Input
          aria-label="Search people in this department"
          placeholder="Search people in this department"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            // Enter here shouldn't submit the surrounding form.
            if (event.key === "Enter") event.preventDefault();
          }}
          className="pl-9"
        />
      </div>
      <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border p-1">
        {isLoading ? (
          <div className="space-y-1 p-1" role="status" aria-label="Loading people">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : isError ? (
          <p className="text-danger p-3 text-sm">Couldn&apos;t load people. Please try again.</p>
        ) : data?.length === 0 ? (
          <p className="text-muted p-3 text-sm">Nobody matches that search.</p>
        ) : (
          data?.map((person) => (
            <label
              key={person.id}
              className="hover:bg-subtle flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm"
            >
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={selectedIds.has(person.id)}
                onChange={() => toggle(person)}
              />
              <Avatar name={person.name} color={person.avatarColor} className="size-7 text-[10px]" />
              <span className="min-w-0 flex-1 truncate">{person.name}</span>
              <span className="text-muted text-xs">{ROLE_LABELS[person.role as Role]}</span>
            </label>
          ))
        )}
      </div>
    </fieldset>
  );
}
