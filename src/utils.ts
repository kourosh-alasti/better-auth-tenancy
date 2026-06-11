import type { GenericEndpointContext } from "@better-auth/core";
import type { OAuthProvider, ProviderOptions } from "@better-auth/core/oauth2";
import type { SocialProviderList } from "@better-auth/core/social-providers";

import { socialProviders } from "@better-auth/core/social-providers";
import { APIError, getSessionFromCtx } from "better-auth/api";
import { TENANT_AUTH_ERROR_CODES } from "./error-codes.ts";
import type { Tenant, TenantAuthOptions, TenantOAuthConfig } from "./types.ts";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";

/**
 * Encrypts an OAuth credential (client id / client secret) for storage
 * at rest, using the auth secret.
 */
export async function encryptCredential(
  ctx: GenericEndpointContext,
  value: string,
): Promise<string> {
  return await symmetricEncrypt({
    key: ctx.context.secretConfig,
    data: value,
  });
}

/**
 * Decrypts an OAuth credential stored at rest. Falls back to returning
 * the raw value for rows created before encryption was introduced.
 */
export async function decryptCredential(
  ctx: GenericEndpointContext,
  value: string,
): Promise<string> {
  try {
    return await symmetricDecrypt({
      key: ctx.context.secretConfig,
      data: value,
    });
  } catch {
    return value;
  }
}

/**
 * Resolves the tenant id from the request. Order: custom resolver,
 * request body, request query, tenant header.
 */
export async function resolveTenantId(
  ctx: GenericEndpointContext,
  options?: TenantAuthOptions,
): Promise<string> {
  if (options?.resolveTenantId) {
    const resolved = await options.resolveTenantId(ctx);
    if (resolved) return resolved;
  }

  const body = ctx.body as { tenantId?: string | undefined } | undefined;
  if (body?.tenantId) return body.tenantId;

  const query = ctx.query as { tenantId?: string | undefined } | undefined;
  if (query?.tenantId) return query.tenantId;

  const header = ctx.headers?.get(options?.tenantHeader ?? "x-tenant-id");
  if (header) return header;

  throw APIError.from("BAD_REQUEST", TENANT_AUTH_ERROR_CODES.TENANT_ID_REQUIRED);
}

/**
 * Resolves the tenant id and ensures the tenant exists.
 */
export async function requireTenant(
  ctx: GenericEndpointContext,
  options?: TenantAuthOptions,
): Promise<Tenant> {
  const tenantId = await resolveTenantId(ctx, options);
  const tenant = await ctx.context.adapter.findOne<Tenant>({
    model: "tenant",
    where: [{ field: "id", value: tenantId }],
  });

  if (!tenant) {
    throw APIError.from("NOT_FOUND", TENANT_AUTH_ERROR_CODES.TENANT_NOT_FOUND);
  }

  return tenant;
}

/**
 * Guards tenant/OAuth-config management endpoints. Uses the
 * `canManageTenants` callback when provided, otherwise requires an
 * authenticated session.
 */
export async function requireManagementAccess(
  ctx: GenericEndpointContext,
  options?: TenantAuthOptions,
): Promise<void> {
  if (options?.canManageTenants) {
    const allowed = await options.canManageTenants(ctx);
    if (!allowed) {
      throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.TENANT_MANAGEMENT_NOT_ALLOWED);
    }

    return;
  }

  const session = await getSessionFromCtx(ctx);
  if (!session) {
    throw APIError.from("UNAUTHORIZED", TENANT_AUTH_ERROR_CODES.TENANT_MANAGEMENT_NOT_ALLOWED);
  }
}

export async function findTenantOAuthConfig(
  ctx: GenericEndpointContext,
  tenantId: string,
  providerId: string,
): Promise<TenantOAuthConfig | null> {
  return await ctx.context.adapter.findOne<TenantOAuthConfig>({
    model: "tenantOauthConfig",
    where: [
      { field: "tenantId", value: tenantId },
      { field: "providerId", value: providerId },
    ],
  });
}

/**
 * Resolves the OAuth provider for a tenant. Prefers the tenant's own
 * configuration stored in the database and falls back to the provider
 * configured globally in the auth config.
 */
export async function resolveTenantProvider(
  ctx: GenericEndpointContext,
  tenantId: string,
  providerId: string,
): Promise<{ provider: OAuthProvider; redirectURI: string }> {
  const defaultRedirectURI = `${ctx.context.baseURL}/tenant/callback/${providerId}`;
  const config = await findTenantOAuthConfig(ctx, tenantId, providerId);
  if (config && config.enabled !== false) {
    const factory = socialProviders[providerId as SocialProviderList[number]];
    if (!factory) {
      throw APIError.from("BAD_REQUEST", TENANT_AUTH_ERROR_CODES.UNSUPPORTED_PROVIDER);
    }

    const redirectURI = config.redirectURI || defaultRedirectURI;
    const providerOptions: ProviderOptions = {
      clientId: await decryptCredential(ctx, config.clientId),
      clientSecret: await decryptCredential(ctx, config.clientSecret),
      redirectURI,
      ...(config.scopes ? { scope: config.scopes.split(",").map((s) => s.trim()) } : {}),
    };

    const provider = (factory as (options: ProviderOptions) => OAuthProvider)(providerOptions);
    return { provider, redirectURI };
  }

  for (const entry of ctx.context.socialProviders) {
    const provider =
      typeof entry === "function"
        ? await (entry as () => Promise<OAuthProvider> | OAuthProvider)()
        : entry;
    if (provider.id === providerId) {
      return { provider, redirectURI: defaultRedirectURI };
    }
  }

  throw APIError.from("NOT_FOUND", TENANT_AUTH_ERROR_CODES.PROVIDER_NOT_FOUND);
}
