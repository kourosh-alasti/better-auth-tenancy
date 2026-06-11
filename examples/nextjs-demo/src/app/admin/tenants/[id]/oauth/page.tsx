import Link from "next/link";
import { notFound } from "next/navigation";

import { listOAuthConfigs, listTenants } from "@/app/admin/actions";
import { DeleteOAuthForm } from "@/app/admin/tenants/[id]/oauth/delete-oauth-form";
import { OAuthConfigForm } from "@/app/admin/tenants/[id]/oauth/oauth-form";
import { Card, Container, PageHeader } from "@/components/ui";

export default async function TenantOAuthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenants = await listTenants();
  const tenant = tenants.find((t) => t.id === id);
  if (!tenant) notFound();

  const configs = await listOAuthConfigs(id);

  return (
    <Container>
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-neutral-600 hover:text-neutral-900">
          ← Admin
        </Link>
      </div>
      <PageHeader
        title={`OAuth config — ${tenant.name}`}
        description="Exercises POST /tenant/oauth-config/register, GET /tenant/oauth-config/list, and POST /tenant/oauth-config/delete."
      />

      <div className="space-y-8">
        <Card>
          <h2 className="mb-4 text-lg font-medium">Register per-tenant Google OAuth</h2>
          <p className="mb-4 text-sm text-neutral-600">
            Tenants with a config use their own client ID. Others fall back to global{" "}
            <code className="rounded bg-neutral-100 px-1">GOOGLE_CLIENT_*</code> env vars.
          </p>
          <OAuthConfigForm tenantId={id} />
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-medium">Current configs</h2>
          {configs.length === 0 ? (
            <p className="text-neutral-600">No per-tenant OAuth configs yet.</p>
          ) : (
            <ul className="space-y-4">
              {configs.map((config) => (
                <li
                  key={config.id}
                  className="flex items-start justify-between gap-4 rounded border border-neutral-200 p-4"
                >
                  <div className="text-sm">
                    <p>
                      <span className="font-medium">Provider:</span> {config.providerId}
                    </p>
                    <p>
                      <span className="font-medium">Client ID:</span> {config.clientId}
                    </p>
                    <p>
                      <span className="font-medium">Enabled:</span> {String(config.enabled ?? true)}
                    </p>
                    {config.redirectURI ? (
                      <p>
                        <span className="font-medium">Redirect URI:</span> {config.redirectURI}
                      </p>
                    ) : null}
                    <p className="mt-1 text-neutral-500">clientSecret is never returned</p>
                  </div>
                  <DeleteOAuthForm tenantId={id} providerId={config.providerId} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Container>
  );
}
