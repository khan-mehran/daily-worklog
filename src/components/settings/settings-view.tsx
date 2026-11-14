"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Card, PageHeader } from "@/components/ui/misc";
import { VsCodeSyncSection } from "./vscode-sync-section";
import { api } from "@/lib/api-client";
import { ROLE_LABELS, type Role, type ThemePreference } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { changePasswordSchema, updateProfileSchema } from "@/validators/user";

interface SettingsUser {
  name: string;
  email: string;
  role: Role;
  department: string | null;
  preferences: { theme: ThemePreference; emailNotifications: boolean; inAppNotifications: boolean };
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card className="grid gap-4 p-6 md:grid-cols-[16rem_1fr]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-muted mt-1 text-sm">{description}</p>
      </div>
      <div className="max-w-md">{children}</div>
    </Card>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-muted block text-xs">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150",
          "focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          checked ? "bg-primary" : "bg-subtle ring-border ring-1 ring-inset",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "bg-surface block size-5 rounded-full shadow-sm transition-transform duration-150",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </label>
  );
}

export function SettingsView({ user }: { user: SettingsUser }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [preferences, setPreferences] = useState(user.preferences);

  const profile = useForm<z.input<typeof updateProfileSchema>>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: user.name },
  });
  const password = useForm<z.input<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const savePreference = useMutation({
    mutationFn: (patch: Partial<SettingsUser["preferences"]>) =>
      api("/api/me/preferences", { method: "PATCH", body: patch }),
    onError: (error) => toast.error(error.message),
  });
  const update = (patch: Partial<SettingsUser["preferences"]>) => {
    setPreferences((current) => ({ ...current, ...patch }));
    if (patch.theme) setTheme(patch.theme);
    savePreference.mutate(patch, { onSuccess: () => toast.success("Saved.") });
  };

  return (
    <>
      <PageHeader title="Settings" description="Your profile, password and how WorkLog contacts you." />
      <div className="space-y-4">
        <Section title="Profile" description={`${ROLE_LABELS[user.role]}${user.department ? ` · ${user.department}` : ""}`}>
          <form
            className="space-y-4"
            noValidate
            onSubmit={profile.handleSubmit(async (values) => {
              try {
                await api("/api/me", { method: "PATCH", body: values });
                toast.success("Profile saved.");
                router.refresh();
              } catch (error) {
                toast.error((error as Error).message);
              }
            })}
          >
            <Field label="Full name" htmlFor="profile-name" error={profile.formState.errors.name?.message}>
              <Input id="profile-name" {...profile.register("name")} />
            </Field>
            <Field label="Email" htmlFor="profile-email" hint="Ask the CEO to change your email.">
              <Input id="profile-email" value={user.email} disabled readOnly />
            </Field>
            <Button type="submit" disabled={profile.formState.isSubmitting}>
              Save profile
            </Button>
          </form>
        </Section>

        <Section title="Password" description="At least 10 characters.">
          <form
            className="space-y-4"
            noValidate
            onSubmit={password.handleSubmit(async (values) => {
              try {
                await api("/api/me/password", { method: "POST", body: values });
                toast.success("Password changed.");
                password.reset();
              } catch (error) {
                toast.error((error as Error).message);
              }
            })}
          >
            <Field label="Current password" htmlFor="pw-current" error={password.formState.errors.currentPassword?.message}>
              <Input id="pw-current" type="password" autoComplete="current-password" {...password.register("currentPassword")} />
            </Field>
            <Field label="New password" htmlFor="pw-new" error={password.formState.errors.newPassword?.message}>
              <Input id="pw-new" type="password" autoComplete="new-password" {...password.register("newPassword")} />
            </Field>
            <Field label="Confirm new password" htmlFor="pw-confirm" error={password.formState.errors.confirmPassword?.message}>
              <Input id="pw-confirm" type="password" autoComplete="new-password" {...password.register("confirmPassword")} />
            </Field>
            <Button type="submit" disabled={password.formState.isSubmitting}>
              Change password
            </Button>
          </form>
        </Section>

        <Section title="Appearance" description="Saved to your account, so it follows you between devices.">
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
            {(
              [
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
                { value: "system", label: "System", icon: Monitor },
              ] as const
            ).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={preferences.theme === value}
                onClick={() => update({ theme: value })}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm transition-colors duration-150",
                  preferences.theme === value ? "border-primary bg-primary/10 font-semibold" : "hover:bg-subtle",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </Section>

        <Section
          title="VS Code sync"
          description="Log your day automatically. A small script reads your git activity in each project and adds one task per project, as bullet points. You can edit the tasks afterwards."
        >
          <VsCodeSyncSection />
        </Section>

        <Section title="Notifications" description="Reviews, approvals, requested changes and reminders.">
          <Toggle
            label="Email notifications"
            description="Send me an email as well as the in-app notification."
            checked={preferences.emailNotifications}
            onChange={(emailNotifications) => update({ emailNotifications })}
          />
          <Toggle
            label="In-app notifications"
            description="Show notifications in the bell and as pop-ups."
            checked={preferences.inAppNotifications}
            onChange={(inAppNotifications) => update({ inAppNotifications })}
          />
        </Section>
      </div>
    </>
  );
}
