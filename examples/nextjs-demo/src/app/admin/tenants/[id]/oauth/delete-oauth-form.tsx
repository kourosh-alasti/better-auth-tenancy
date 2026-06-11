"use client";

import { useActionState } from "react";

import { deleteOAuthConfigAction } from "@/app/admin/actions";
import { Button, ErrorAlert } from "@/components/ui";

export function DeleteOAuthForm({
  tenantId,
  providerId,
}: {
  tenantId: string;
  providerId: string;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => {
      if (!confirm(`Delete OAuth config for ${providerId}?`)) return null;
      const result = await deleteOAuthConfigAction(formData);
      if (!result.success) return { error: result.error };
      return null;
    },
    null,
  );

  return (
    <form action={action}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="providerId" value={providerId} />
      {state?.error ? <ErrorAlert message={state.error} /> : null}
      <Button type="submit" variant="danger" disabled={pending}>
        Delete
      </Button>
    </form>
  );
}
