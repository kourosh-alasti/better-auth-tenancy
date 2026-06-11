import Link from "next/link";

import { SignInForm } from "@/app/t/[slug]/sign-in-form";
import { Card, Container, PageHeader } from "@/components/ui";
import { getTenantBySlug } from "@/lib/tenant";

export default async function SignInPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);

  return (
    <Container>
      <div className="mb-6">
        <Link href={`/t/${slug}`} className="text-sm text-neutral-600 hover:text-neutral-900">
          ← {tenant.name}
        </Link>
      </div>
      <PageHeader
        title="Sign in"
        description={`POST /tenant/sign-in/email scoped to tenant ${tenant.slug}`}
      />
      <Card>
        <SignInForm tenantId={tenant.id} slug={slug} />
      </Card>
    </Container>
  );
}
