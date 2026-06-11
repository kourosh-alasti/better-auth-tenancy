import Link from "next/link";

import { SignUpForm } from "@/app/t/[slug]/sign-up-form";
import { Card, Container, PageHeader } from "@/components/ui";
import { getTenantBySlug } from "@/lib/tenant";

export default async function SignUpPage({ params }: { params: Promise<{ slug: string }> }) {
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
        title="Sign up"
        description={`POST /tenant/sign-up/email scoped to tenant ${tenant.slug}`}
      />
      <Card>
        <SignUpForm tenantId={tenant.id} slug={slug} />
      </Card>
    </Container>
  );
}
