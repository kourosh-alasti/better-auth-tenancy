import Link from "next/link";

import { Card, Container, PageHeader } from "@/components/ui";

const features = [
  { endpoint: "POST /tenant/create", ui: "/admin — Create tenant form" },
  { endpoint: "GET /tenant/list", ui: "/admin — Tenant table" },
  { endpoint: "POST /tenant/update", ui: "/admin — Update tenant" },
  { endpoint: "POST /tenant/delete", ui: "/admin — Delete tenant" },
  { endpoint: "GET /tenant/get", ui: "/t/[slug] — Public tenant landing" },
  { endpoint: "POST /tenant/sign-up/email", ui: "/t/[slug]/sign-up" },
  { endpoint: "POST /tenant/sign-in/email", ui: "/t/[slug]/sign-in" },
  { endpoint: "POST /tenant/sign-in/social", ui: "/t/[slug]/sign-in — Google button" },
  { endpoint: "GET /tenant/callback/:providerId", ui: "Handled by /api/auth (OAuth redirect)" },
  { endpoint: "POST /tenant/oauth-config/register", ui: "/admin/tenants/[id]/oauth" },
  { endpoint: "GET /tenant/oauth-config/list", ui: "/admin/tenants/[id]/oauth" },
  { endpoint: "POST /tenant/oauth-config/delete", ui: "/admin/tenants/[id]/oauth" },
];

export default function HomePage() {
  return (
    <Container>
      <PageHeader
        title="Better Auth Tenancy Demo"
        description="A Next.js app demonstrating every endpoint in better-auth-tenancy with PostgreSQL."
      />

      <div className="mb-8 flex flex-wrap gap-3">
        <Link
          href="/admin"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Admin portal
        </Link>
        <Link
          href="/t/tenant-a"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
        >
          Example tenant (create first)
        </Link>
      </div>

      <Card className="mb-8">
        <h2 className="mb-3 text-lg font-medium">Multi-tenant email demo</h2>
        <p className="text-sm text-neutral-600">
          Create two tenants (e.g. <code className="rounded bg-neutral-100 px-1">tenant-a</code> and{" "}
          <code className="rounded bg-neutral-100 px-1">tenant-b</code>), then sign up with the same
          email <code className="rounded bg-neutral-100 px-1">shared@demo.com</code> on each using
          different passwords. Sign-in is scoped per tenant — password from tenant A will not work
          on tenant B.
        </p>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-medium">Feature map</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="pb-2 pr-4 font-medium">Endpoint</th>
              <th className="pb-2 font-medium">UI</th>
            </tr>
          </thead>
          <tbody>
            {features.map((f) => (
              <tr key={f.endpoint} className="border-b border-neutral-100">
                <td className="py-2 pr-4 font-mono text-xs">{f.endpoint}</td>
                <td className="py-2 text-neutral-600">{f.ui}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Container>
  );
}
