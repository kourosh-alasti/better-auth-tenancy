"use client";

import { useActionState } from "react";

import { registerOAuthConfigAction } from "@/app/admin/actions";
import { Button, ErrorAlert, Input, SuccessAlert } from "@/components/ui";

export function OAuthConfigForm({ tenantId }: { tenantId: string }) {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string; success?: boolean } | null, formData: FormData) => {
      const result = await registerOAuthConfigAction(formData);
      if (!result.success) return { error: result.error };
      return { success: true };
    },
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="providerId" value="google" />
      {state?.error ? <ErrorAlert message={state.error} /> : null}
      {state?.success ? <SuccessAlert message="OAuth config registered (upsert)." /> : null}
      <Input label="Client ID" name="clientId" required placeholder="tenant-specific-client-id" />
      <Input
        label="Client Secret"
        name="clientSecret"
        type="password"
        required
        placeholder="tenant-specific-client-secret"
      />
      <Input
        label="Redirect URI override (optional)"
        name="redirectURI"
        placeholder="http://localhost:3000/api/auth/tenant/callback/google"
      />
      <Input label="Scopes (optional)" name="scopes" placeholder="openid email profile" />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Register / update Google OAuth config"}
      </Button>
    </form>
  );
}
