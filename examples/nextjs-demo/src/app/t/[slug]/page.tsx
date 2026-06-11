import Link from "next/link";

import { Card, Container, PageHeader } from "@/components/ui";
import { getTenantBySlug } from "@/lib/tenant";

export default async function TenantLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);

  let metadata: Record<string, unknown> | null = null;
  if (tenant.metadata) {
    try {
      metadata = JSON.parse(tenant.metadata) as Record<string, unknown>;
    } catch {
      metadata = { raw: tenant.metadata };
    }
  }

  return (
    <Container>
      <div className="mb-6">
        <Link href="/" className="text-sm text-neutral-600 hover:text-neutral-900">
          ← Home
        </Link>
      </div>
      <PageHeader
        title={tenant.name}
        description={`Public tenant landing via GET /tenant/get?slug=${slug}`}
      />

      <Card className="mb-6">
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="font-medium text-neutral-500">ID</dt>
            <dd className="font-mono">{tenant.id}</dd>
          </div>
          <div>
            <dt className="font-medium text-neutral-500">Slug</dt>
            <dd>{tenant.slug}</dd>
          </div>
          {metadata ? (
            <div>
              <dt className="font-medium text-neutral-500">Metadata</dt>
              <dd>
                <pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2 text-xs">
                  {JSON.stringify(metadata, null, 2)}
                </pre>
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <div className="flex gap-3">
        <Link
          href={`/t/${slug}/sign-up`}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Sign up
        </Link>
        <Link
          href={`/t/${slug}/sign-in`}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
        >
          Sign in
        </Link>
        <Link
          href={`/t/${slug}/dashboard`}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
        >
          Dashboard
        </Link>
      </div>
    </Container>
  );
}
