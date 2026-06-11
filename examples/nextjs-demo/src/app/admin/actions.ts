// oxlint-disable typescript/no-base-to-string
"use server";

import type { Tenant } from "@better-auth/tenancy";
import { revalidatePath } from "next/cache";

import { adminHeaders } from "@/lib/admin";
import { auth } from "@/lib/auth";

function parseMetadata(raw: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { value: raw };
  }
}

function formatError(error: unknown): string {
  if (error && typeof error === "object" && "body" in error) {
    const body = (error as { body?: { code?: string; message?: string } }).body;
    if (body?.code) return body.code;
    if (body?.message) return body.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

export async function createTenantAction(formData: FormData) {
  const name = String(formData.get("name") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const metadata = parseMetadata(String(formData.get("metadata") ?? "").trim());

  try {
    await auth.api.createTenant({
      body: {
        name,
        slug,
        ...(metadata ? { metadata } : {}),
      },
      headers: adminHeaders(),
    });
    revalidatePath("/admin");
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: formatError(error) };
  }
}

export async function updateTenantAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const metadata = parseMetadata(String(formData.get("metadata") ?? "").trim());

  try {
    await auth.api.updateTenant({
      body: {
        id,
        data: {
          name,
          slug,
          ...(metadata ? { metadata } : {}),
        },
      },
      headers: adminHeaders(),
    });
    revalidatePath("/admin");
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: formatError(error) };
  }
}

export async function deleteTenantAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");

  try {
    await auth.api.deleteTenant({
      body: { id },
      headers: adminHeaders(),
    });
    revalidatePath("/admin");
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: formatError(error) };
  }
}

export async function registerOAuthConfigAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const providerId = String(formData.get("providerId") ?? "google");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSecret = String(formData.get("clientSecret") ?? "");
  const redirectURI = String(formData.get("redirectURI") ?? "").trim();
  const scopesRaw = String(formData.get("scopes") ?? "").trim();
  const scopes = scopesRaw ? scopesRaw.split(/[\s,]+/).filter(Boolean) : undefined;

  try {
    await auth.api.registerTenantOAuthConfig({
      body: {
        tenantId,
        providerId,
        clientId,
        clientSecret,
        ...(redirectURI ? { redirectURI } : {}),
        ...(scopes?.length ? { scopes } : {}),
      },
      headers: adminHeaders(),
    });
    revalidatePath(`/admin/tenants/${tenantId}/oauth`);
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: formatError(error) };
  }
}

export async function deleteOAuthConfigAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const providerId = String(formData.get("providerId") ?? "");

  try {
    await auth.api.deleteTenantOAuthConfig({
      body: { tenantId, providerId },
      headers: adminHeaders(),
    });
    revalidatePath(`/admin/tenants/${tenantId}/oauth`);
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: formatError(error) };
  }
}

export async function listTenants(): Promise<Tenant[]> {
  return auth.api.listTenants({ headers: adminHeaders() });
}

export async function listOAuthConfigs(tenantId: string) {
  return auth.api.listTenantOAuthConfigs({
    query: { tenantId },
    headers: adminHeaders(),
  });
}
