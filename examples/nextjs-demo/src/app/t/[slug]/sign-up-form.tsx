// oxlint-disable typescript/no-base-to-string
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { tenantClient } from "@/lib/tenant-client";
import { Button, ErrorAlert, Input } from "@/components/ui";

export function SignUpForm({ tenantId, slug }: { tenantId: string; slug: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { error: signUpError } = await tenantClient.signUp.email({
      tenantId,
      name: String(form.get("name")),
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (signUpError) {
      setError(signUpError.message ?? signUpError.statusText ?? "Sign up failed");
      return;
    }
    router.push(`/t/${slug}/dashboard`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? <ErrorAlert message={error} /> : null}
      <Input label="Name" name="name" required />
      <Input label="Email" name="email" type="email" required />
      <Input label="Password" name="password" type="password" required minLength={8} />
      <Button type="submit" disabled={pending}>
        {pending ? "Signing up..." : "Sign up"}
      </Button>
    </form>
  );
}
