import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";

export async function getTenantBySlug(slug: string) {
  try {
    return await auth.api.getTenant({ query: { slug } });
  } catch {
    notFound();
  }
}

export async function getSession() {
  const hdrs = await headers();
  return auth.api.getSession({
    headers: hdrs,
  });
}
