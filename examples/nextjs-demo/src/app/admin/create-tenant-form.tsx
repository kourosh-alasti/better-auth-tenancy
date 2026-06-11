"use client";

import { useActionState } from "react";

import { createTenantAction } from "@/app/admin/actions";
import { Button, ErrorAlert, Input, Textarea } from "@/components/ui";

export function CreateTenantForm() {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => {
      const result = await createTenantAction(formData);
      if (!result.success) return { error: result.error };
      return null;
    },
    null,
  );

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <ErrorAlert message={state.error} /> : null}
      <Input label="Name" name="name" required placeholder="Acme Corp" />
      <Input label="Slug" name="slug" required placeholder="acme" />
      <Textarea
        label="Metadata (JSON object, optional)"
        name="metadata"
        rows={3}
        placeholder='{"theme":"blue"}'
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create tenant"}
      </Button>
    </form>
  );
}
