"use client";

import Link from "next/link";
import { useActionState } from "react";

import { deleteTenantAction, updateTenantAction } from "@/app/admin/actions";
import type { Tenant } from "better-auth-tenancy";

import { Button, ErrorAlert, Input, Textarea } from "@/components/ui";

export function TenantRow({ tenant }: { tenant: Tenant }) {
  const [updateState, updateAction, updatePending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => {
      const result = await updateTenantAction(formData);
      if (!result.success) return { error: result.error };
      return null;
    },
    null,
  );

  const [deleteState, deleteAction, deletePending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => {
      if (!confirm(`Delete tenant "${tenant.slug}"?`)) return null;
      const result = await deleteTenantAction(formData);
      if (!result.success) return { error: result.error };
      return null;
    },
    null,
  );

  return (
    <div className="space-y-4 rounded-lg border border-neutral-200 p-4">
      <form action={updateAction} className="space-y-3">
        <input type="hidden" name="id" value={tenant.id} />
        {updateState?.error ? <ErrorAlert message={updateState.error} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" name="name" defaultValue={tenant.name} required />
          <Input label="Slug" name="slug" defaultValue={tenant.slug} required />
        </div>
        <Textarea label="Metadata" name="metadata" rows={2} defaultValue={tenant.metadata ?? ""} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" disabled={updatePending}>
            {updatePending ? "Saving..." : "Update"}
          </Button>
          <Link
            href={`/admin/tenants/${tenant.id}/oauth`}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            OAuth config
          </Link>
          <Link
            href={`/t/${tenant.slug}`}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            Open tenant
          </Link>
        </div>
      </form>
      <form action={deleteAction}>
        <input type="hidden" name="id" value={tenant.id} />
        {deleteState?.error ? <ErrorAlert message={deleteState.error} /> : null}
        <Button type="submit" variant="danger" disabled={deletePending}>
          {deletePending ? "Deleting..." : "Delete tenant"}
        </Button>
      </form>
    </div>
  );
}
