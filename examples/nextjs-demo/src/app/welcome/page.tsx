import Link from "next/link";

import { Card, Container, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/tenant";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant: tenantSlug } = await searchParams;
  const session = await getSession();
  const sessionTenantId = session ? (session.session as { tenantId?: string }).tenantId : undefined;

  return (
    <Container>
      <PageHeader
        title="Welcome"
        description="OAuth callback redirect target after GET /tenant/callback/:providerId"
      />
      <Card>
        {session ? (
          <div className="space-y-2 text-sm">
            <p>
              Signed in as <strong>{session.user.email}</strong>
            </p>
            <p>
              Session <code className="rounded bg-neutral-100 px-1">tenantId</code>:{" "}
              <span className="font-mono">{sessionTenantId ?? "(none)"}</span>
            </p>
            {tenantSlug ? (
              <Link
                href={`/t/${tenantSlug}/dashboard`}
                className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
              >
                Go to dashboard
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="text-neutral-600">No active session. Complete OAuth sign-in first.</p>
        )}
      </Card>
      <div className="mt-6">
        <Link href="/" className="text-sm text-neutral-600 hover:text-neutral-900">
          ← Home
        </Link>
      </div>
    </Container>
  );
}
