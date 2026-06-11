// oxlint-disable typescript/no-base-to-string
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { tenantClient } from "@/lib/tenant-client";
import { Button, ErrorAlert, Input } from "@/components/ui";

const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";

export function SignInForm({ tenantId, slug }: { tenantId: string; slug: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [useSlugHeader, setUseSlugHeader] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));

    if (useSlugHeader) {
      const res = await fetch("/api/demo/sign-in-with-slug-header", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, email, password }),
        credentials: "include",
      });
      setPending(false);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Sign in failed");
        return;
      }
      router.push(`/t/${slug}/dashboard`);
      router.refresh();
      return;
    }

    const { error: signInError } = await tenantClient.signIn.email({
      tenantId,
      email,
      password,
    });
    setPending(false);
    if (signInError) {
      setError(signInError.message ?? signInError.statusText ?? "Sign in failed");
      return;
    }
    router.push(`/t/${slug}/dashboard`);
    router.refresh();
  }

  async function signInWithGoogle() {
    setError(null);
    setPending(true);
    const { data, error: socialError } = await tenantClient.signIn.social({
      tenantId,
      provider: "google",
      callbackURL: `/welcome?tenant=${slug}`,
    });
    setPending(false);
    if (socialError) {
      setError(socialError.message ?? "OAuth sign-in failed");
      return;
    }
    if (data?.url) {
      window.location.href = data.url;
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="space-y-4">
        {error ? <ErrorAlert message={error} /> : null}
        <Input label="Email" name="email" type="email" required />
        <Input label="Password" name="password" type="password" required />
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={useSlugHeader}
            onChange={(e) => setUseSlugHeader(e.target.checked)}
          />
          Resolve tenant via <code className="rounded bg-neutral-100 px-1">x-tenant-slug</code>{" "}
          header (no tenantId in body)
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Signing in..." : "Sign in with email"}
        </Button>
      </form>

      {googleEnabled ? (
        <div className="border-t border-neutral-200 pt-6">
          <p className="mb-3 text-sm text-neutral-600">
            POST /tenant/sign-in/social — uses per-tenant OAuth config or global fallback.
          </p>
          <Button type="button" variant="secondary" disabled={pending} onClick={signInWithGoogle}>
            Sign in with Google
          </Button>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">
          Set <code className="rounded bg-neutral-100 px-1">GOOGLE_CLIENT_ID</code> and{" "}
          <code className="rounded bg-neutral-100 px-1">NEXT_PUBLIC_GOOGLE_ENABLED=true</code> to
          enable Google sign-in.
        </p>
      )}
    </div>
  );
}
