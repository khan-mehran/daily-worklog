import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-xl font-bold">Sign in</h1>
      <p className="text-muted mt-1 mb-5 text-sm">Accounts are created by your administrator.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </>
  );
}
