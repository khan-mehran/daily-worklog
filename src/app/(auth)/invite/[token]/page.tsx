import type { Metadata } from "next";
import Link from "next/link";
import { connectDB } from "@/lib/db/connect";
import { inviteIsValid } from "@/lib/users/service";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Set your password" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await connectDB();
  const valid = /^[a-f\d]{64}$/.test(token) && (await inviteIsValid(token));

  if (!valid) {
    return (
      <>
        <h1 className="text-xl font-bold">This invite has expired</h1>
        <p className="text-muted mt-1 text-sm">
          Ask your CEO to send a new invite, or{" "}
          <Link href="/login" className="text-primary font-medium underline">
            sign in
          </Link>{" "}
          if you&apos;ve already set a password.
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-xl font-bold">Set your password</h1>
      <p className="text-muted mt-1 mb-5 text-sm">Choose a password to finish your account.</p>
      <InviteForm token={token} />
    </>
  );
}
