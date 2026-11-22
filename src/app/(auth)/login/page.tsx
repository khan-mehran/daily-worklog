import { Briefcase, Clock, ShieldCheck, Zap } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { ENTRA_LOGIN_PATH, entraSettings, safeCallbackPath } from "@/lib/auth/entra";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  not_configured: "Microsoft sign-in isn't set up on this server yet.",
  sso_expired: "That sign-in took too long. Please try again.",
  sso_failed: "Microsoft sign-in didn't complete. Please try again.",
  sso_tenant: "Use your organisation's Microsoft account to sign in.",
  CredentialsSignin: "Sign-in didn't complete. Please try again.",
};

// Where the Microsoft callback sends someone it couldn't let in.
const STATUSES: Record<string, { title: string; message: string }> = {
  pending: {
    title: "Waiting for approval",
    message:
      "Your account has been created and an administrator has been told. You'll be able to sign in as soon as they approve it and give you a role.",
  },
  rejected: {
    title: "Access not approved",
    message: "Your request for access was declined. Contact your administrator if you think that's a mistake.",
  },
  inactive: {
    title: "Account deactivated",
    message: "Your GET List account has been deactivated. Contact your administrator.",
  },
};

const ASSURANCES = [
  { icon: ShieldCheck, label: "Secure SSO" },
  { icon: Briefcase, label: "Work account" },
  { icon: Zap, label: "Quick access" },
];

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; status?: string; callbackUrl?: string }>;
}) {
  const { error, status, callbackUrl } = await searchParams;
  const configured = entraSettings() !== null;
  const notice = status ? STATUSES[status] : undefined;
  const problem = error ? ERRORS[error] : configured ? undefined : ERRORS.not_configured;
  const startUrl = `${ENTRA_LOGIN_PATH}?callbackUrl=${encodeURIComponent(safeCallbackPath(callbackUrl))}`;

  return (
    <>
      <div className="bg-surface rounded-2xl border p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-muted mt-2 text-sm leading-relaxed">
          Sign in with your organisation&apos;s Microsoft account to open GET List. The first time you sign
          in, an administrator approves your access.
        </p>

        {notice ? (
          <div role="status" className="bg-subtle mt-6 flex gap-3 rounded-lg border p-4">
            <Clock className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <p className="text-sm font-semibold">{notice.title}</p>
              <p className="text-muted mt-1 text-sm">{notice.message}</p>
            </div>
          </div>
        ) : null}
        {problem ? (
          <p role="alert" className="text-danger mt-6 text-sm font-medium">
            {problem}
          </p>
        ) : null}

        {configured ? (
          <>
            <div className="text-muted my-6 flex items-center gap-3 text-xs font-semibold tracking-wider uppercase">
              <span className="bg-border h-px flex-1" />
              Continue with
              <span className="bg-border h-px flex-1" />
            </div>
            <Button asChild className="h-12 w-full" variant={notice ? "secondary" : "primary"}>
              {/* A full navigation, not a client transition: this leaves for Microsoft. */}
              <a href={startUrl}>
                <MicrosoftLogo />
                {notice ? "Try again" : "Sign in with Microsoft"}
              </a>
            </Button>
            <ul className="text-muted mt-6 grid grid-cols-3 gap-2 text-center text-xs font-medium">
              {ASSURANCES.map(({ icon: Icon, label }) => (
                <li key={label} className="bg-subtle flex flex-col items-center gap-1.5 rounded-lg px-2 py-3">
                  <Icon className="text-primary size-4" aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <p className="text-muted-on-background mt-6 text-center text-sm">
        Trouble signing in?{" "}
        <a
          className="text-primary font-semibold underline-offset-2 hover:underline"
          href={`mailto:support@gord.qa?subject=${encodeURIComponent("GET List sign-in issue")}`}
        >
          Contact support
        </a>
      </p>
    </>
  );
}
