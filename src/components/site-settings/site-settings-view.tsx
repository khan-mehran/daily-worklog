"use client";

import { useMutation } from "@tanstack/react-query";
import { Lock, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Badge, Card, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api-client";
import type { EnvSettings } from "@/lib/site-settings/env";
import type { ApprovalSettings } from "@/lib/site-settings/service";
import { cn } from "@/lib/utils";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="grid gap-4 p-6 md:grid-cols-[16rem_1fr]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-muted mt-1 text-sm">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </Card>
  );
}

function RoleCheckbox({
  label,
  description,
  checked,
  locked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  locked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3",
        locked ? "bg-subtle" : "cursor-pointer",
      )}
    >
      <input
        type="checkbox"
        className="accent-primary mt-0.5 size-4 shrink-0"
        checked={checked}
        disabled={locked}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium">
          {label}
          {locked ? <Lock className="text-muted size-3.5" aria-label="Always required" /> : null}
        </span>
        <span className="text-muted mt-0.5 block text-xs">{description}</span>
      </span>
    </label>
  );
}

function ApprovalSection({ initial }: { initial: ApprovalSettings }) {
  const [saved, setSaved] = useState(initial);
  const [teamLeadReview, setTeamLeadReview] = useState(initial.teamLeadReview);

  const save = useMutation({
    mutationFn: () =>
      api<{ settings: ApprovalSettings; rerouted: number }>("/api/site-settings/approval", {
        method: "PATCH",
        body: { teamLeadReview },
      }),
    onSuccess: ({ settings, rerouted }) => {
      setSaved(settings);
      toast.success(
        rerouted > 0
          ? `Saved. ${rerouted} waiting ${rerouted === 1 ? "report was" : "reports were"} passed on to the Manager.`
          : "Saved.",
      );
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Section
      title="Approval chain"
      description="Who reviews a Developer's weekly report. Untick a role to exempt it from reviewing."
    >
      <div className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-2">
          <RoleCheckbox
            label="Team Lead"
            description={
              teamLeadReview
                ? "Reviews their developers' reports first, then passes them on."
                : "Exempt. Developers' reports go straight to their department's Manager, or the Super Admin for the IT department."
            }
            checked={teamLeadReview}
            onChange={setTeamLeadReview}
          />
          <RoleCheckbox
            label="Manager, or the Super Admin for the IT department"
            description="Gives the final approval. This step can't be turned off."
            checked
            locked
          />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || teamLeadReview === saved.teamLeadReview}
          >
            Save approval chain
          </Button>
          {teamLeadReview === saved.teamLeadReview ? null : (
            <p className="text-muted text-xs">
              {teamLeadReview
                ? "Applies to reports submitted from now on."
                : "Reports now waiting for a Team Lead will be passed on to the Manager."}
            </p>
          )}
        </div>
      </div>
    </Section>
  );
}

const startingValues = (env: EnvSettings) =>
  Object.fromEntries(env.fields.map((field) => [field.key, field.value]));

function EnvSection({ initial }: { initial: EnvSettings }) {
  const router = useRouter();
  const [env, setEnv] = useState(initial);
  const [values, setValues] = useState(() => startingValues(initial));
  /** Optional secrets to remove on save. */
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());

  const groups = useMemo(() => {
    const byGroup = new Map<string, EnvSettings["fields"]>();
    for (const field of env.fields)
      byGroup.set(field.group, [...(byGroup.get(field.group) ?? []), field]);
    return [...byGroup];
  }, [env]);

  const changes = useMemo(() => {
    const patch: Record<string, string> = {};
    for (const field of env.fields) {
      const value = (values[field.key] ?? "").trim();
      if (field.secret) {
        if (value) patch[field.key] = value;
        else if (cleared.has(field.key)) patch[field.key] = "";
      } else if (value !== field.value) {
        patch[field.key] = value;
      }
    }
    return patch;
  }, [env, values, cleared]);
  const changeCount = Object.keys(changes).length;

  const save = useMutation({
    mutationFn: () =>
      api<{ settings: EnvSettings; restart: string[] }>("/api/site-settings/env", {
        method: "PATCH",
        body: { values: changes },
      }),
    onSuccess: ({ settings, restart }) => {
      setEnv(settings);
      setValues(startingValues(settings));
      setCleared(new Set());
      if (restart.length) {
        toast.warning(`Saved. Restart the server to apply: ${restart.join(", ")}.`, {
          duration: 10000,
        });
      } else {
        toast.success("Saved. The new values are in use.");
      }
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleCleared = (key: string) =>
    setCleared((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <Section
      title="Environment"
      description={
        <>
          The values in <code className="text-xs">{env.file}</code>. Secrets are never shown: leave
          one blank to keep it. The previous file is kept as{" "}
          <code className="text-xs">.env.backup.local</code>.
        </>
      }
    >
      <form
        className="space-y-6"
        noValidate
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          if (changeCount) save.mutate();
        }}
      >
        {groups.map(([group, fields]) => (
          <fieldset key={group} className="space-y-4">
            <legend className="text-muted text-xs font-semibold tracking-wide uppercase">
              {group}
            </legend>
            <div className="grid gap-x-6 gap-y-5 lg:grid-cols-2">
              {fields.map((field) => {
                const id = `env-${field.key}`;
                const willClear = cleared.has(field.key);
                return (
                  <Field key={field.key} label={field.label} htmlFor={id} hint={field.hint}>
                    <div className="flex items-center gap-2">
                      <Input
                        id={id}
                        type={field.secret ? "password" : "text"}
                        autoComplete={field.secret ? "new-password" : "off"}
                        spellCheck={false}
                        className="font-mono"
                        disabled={willClear}
                        value={values[field.key] ?? ""}
                        placeholder={
                          !field.secret
                            ? "Not set"
                            : willClear
                              ? "Will be removed when you save"
                              : field.isSet
                                ? "Saved. Type a new value to replace it."
                                : "Not set"
                        }
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [field.key]: event.target.value }))
                        }
                      />
                      {field.secret && field.isSet && !field.required ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => toggleCleared(field.key)}
                        >
                          {willClear ? "Keep" : "Clear"}
                        </Button>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <code className="text-muted text-xs">{field.key}</code>
                      {field.restart ? (
                        <Badge className="text-warning-text">
                          <RotateCcw className="size-3" aria-hidden />
                          Needs a restart
                        </Badge>
                      ) : null}
                    </div>
                  </Field>
                );
              })}
            </div>
          </fieldset>
        ))}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.isPending || changeCount === 0}>
            Save environment
          </Button>
          {changeCount ? (
            <p className="text-muted text-xs">
              {changeCount} {changeCount === 1 ? "change" : "changes"} to save
            </p>
          ) : null}
        </div>
      </form>
    </Section>
  );
}

export function SiteSettingsView({
  approval,
  env,
}: {
  approval: ApprovalSettings;
  env: EnvSettings;
}) {
  return (
    <>
      <PageHeader
        title="Site settings"
        description="Settings for the whole of GET List. Only Super Admins see this page."
      />
      <div className="space-y-4">
        <ApprovalSection initial={approval} />
        <EnvSection initial={env} />
      </div>
    </>
  );
}
