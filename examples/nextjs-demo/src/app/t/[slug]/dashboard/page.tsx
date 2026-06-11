import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, Container, PageHeader } from "@/components/ui";
import { getSession, getTenantBySlug } from "@/lib/tenant";

export default async function DashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  const session = await getSession();

  if (!session) {
    redirect(`/t/${slug}/sign-in`);
  }

  const sessionTenantId = (session.session as { tenantId?: string }).tenantId;
  if (sessionTenantId && sessionTenantId !== tenant.id) {
    redirect(`/t/${slug}/sign-in`);
  }

  return (
    <Container>
      <div className="mb-6">
        <Link href={`/t/${slug}`} className="text-sm text-neutral-600 hover:text-neutral-900">
          ← {tenant.name}
        </Link>
      </div>
      <PageHeader
        title="Dashboard"
        description="Protected page showing session.tenantId from tenant-scoped auth."
      />

      <Card>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium text-neutral-500">User</dt>
            <dd>
              {session.user.name} ({session.user.email})
            </dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-500">User ID</dt>
            <dd className="font-mono">{session.user.id}</dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-500">Session tenantId</dt>
            <dd className="font-mono">{sessionTenantId ?? "(none)"}</dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-500">Expected tenant</dt>
            <dd>
              {tenant.name} <span className="font-mono text-neutral-500">({tenant.id})</span>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-500">Match</dt>
            <dd>
              {sessionTenantId === tenant.id ? (
                <span className="text-green-700">Session is scoped to this tenant</span>
              ) : (
                <span className="text-red-700">Tenant mismatch</span>
              )}
            </dd>
          </div>
        </dl>
      </Card>
    </Container>
  );
}
