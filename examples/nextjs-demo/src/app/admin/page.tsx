import Link from "next/link";

import { CreateTenantForm } from "@/app/admin/create-tenant-form";
import { listTenants } from "@/app/admin/actions";
import { TenantRow } from "@/app/admin/tenant-row";
import { Card, Container, PageHeader } from "@/components/ui";

export default async function AdminPage() {
  const tenants = await listTenants();

  return (
    <Container>
      <div className="mb-6">
        <Link href="/" className="text-sm text-neutral-600 hover:text-neutral-900">
          ← Home
        </Link>
      </div>
      <PageHeader
        title="Admin — Tenant management"
        description="Exercises POST /tenant/create, GET /tenant/list, POST /tenant/update, and POST /tenant/delete via server actions with x-admin-key."
      />

      <div className="space-y-8">
        <Card>
          <h2 className="mb-4 text-lg font-medium">Create tenant</h2>
          <CreateTenantForm />
        </Card>

        <div>
          <h2 className="mb-4 text-lg font-medium">Tenants ({tenants.length})</h2>
          <div className="space-y-4">
            {tenants.length === 0 ? (
              <p className="text-neutral-600">No tenants yet. Create one above.</p>
            ) : (
              tenants.map((tenant) => <TenantRow key={tenant.id} tenant={tenant} />)
            )}
          </div>
        </div>
      </div>
    </Container>
  );
}
