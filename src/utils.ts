import type { GenericEndpointContext } from "@better-auth/core";
import type { OAuthProvider, ProviderOptions } from "@better-auth/core/oauth2";
import type { SocialProviderList } from "@better-auth/core/social-providers";

import { socialProviders } from "@better-auth/core/social-providers";
import { APIError, getSessionFromCtx } from "better-auth/api";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { TENANT_AUTH_ERROR_CODES } from "./error-codes.ts";
import type {
  Tenant,
  TenantAuthOptions,
  TenantMember,
  TenantOAuthConfig,
  TenantRole,
} from "./types.ts";

const ROLE_RANK: Record<TenantRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

export function isTenantRole(value: string): value is TenantRole {
  return value === "owner" || value === "admin" || value === "member";
}

export function roleAtLeast(role: TenantRole, minimum: TenantRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

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
 * Result of resolving who may manage tenants.
 *
 * - `global` — `canManageTenants` returned true (operator / API key)
 * - `user` — authenticated platform user; access is per-tenant via membership
 */
export type ManagementAccess =
  | { kind: "global"; userId: string | null }
  | { kind: "user"; userId: string };

type SessionUser = { id: string; tenantId?: string | null | undefined };

/**
 * Resolves management access for tenant/OAuth-config endpoints.
 *
 * Order:
 * 1. `canManageTenants` returning true → global access
 * 2. Authenticated platform user (`user.tenantId` null) → per-tenant membership
 * 3. Otherwise deny (no “any session is admin” fallback)
 */
export async function resolveManagementAccess(
  ctx: GenericEndpointContext,
  options?: TenantAuthOptions,
): Promise<ManagementAccess> {
  const session = await getSessionFromCtx(ctx);
  const user = session?.user as SessionUser | undefined;

  if (options?.canManageTenants) {
    const allowed = await options.canManageTenants(ctx);
    if (allowed) {
      return { kind: "global", userId: user?.id ?? null };
    }
  }

  if (!user) {
    throw APIError.from("UNAUTHORIZED", TENANT_AUTH_ERROR_CODES.TENANT_MANAGEMENT_NOT_ALLOWED);
  }

  // Tenant end-users authenticate under a tenant; only platform users
  // (null tenantId) may own or manage tenants.
  if (user.tenantId) {
    throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.TENANT_MANAGEMENT_NOT_ALLOWED);
  }

  return { kind: "user", userId: user.id };
}

export async function findTenantMember(
  ctx: GenericEndpointContext,
  tenantId: string,
  userId: string,
): Promise<TenantMember | null> {
  return await ctx.context.adapter.findOne<TenantMember>({
    model: "tenantMember",
    where: [
      { field: "tenantId", value: tenantId },
      { field: "userId", value: userId },
    ],
  });
}

/**
 * Resolves the caller's role on a tenant. Prefers `tenantMember`; falls
 * back to `tenant.ownerId` for rows created before membership existed.
 */
export async function resolveTenantRole(
  ctx: GenericEndpointContext,
  tenant: Tenant,
  userId: string,
): Promise<TenantRole | null> {
  const member = await findTenantMember(ctx, tenant.id, userId);
  if (member && isTenantRole(member.role)) {
    return member.role;
  }
  if (tenant.ownerId && tenant.ownerId === userId) {
    return "owner";
  }
  return null;
}

/**
 * Ensures the caller may manage a specific tenant at least at
 * `minimumRole`. Global access always passes.
 */
export async function assertCanManageTenant(
  ctx: GenericEndpointContext,
  access: ManagementAccess,
  tenant: Tenant,
  minimumRole: TenantRole = "admin",
): Promise<void> {
  if (access.kind === "global") return;

  const role = await resolveTenantRole(ctx, tenant, access.userId);
  if (!role) {
    throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.TENANT_NOT_OWNED);
  }
  if (!roleAtLeast(role, minimumRole)) {
    throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.TENANT_MANAGEMENT_NOT_ALLOWED);
  }
}

/**
 * Creates an owner membership for a platform user on a newly created tenant.
 */
export async function createOwnerMembership(
  ctx: GenericEndpointContext,
  tenantId: string,
  userId: string,
): Promise<TenantMember> {
  return await ctx.context.adapter.create<Omit<TenantMember, "id">, TenantMember>({
    model: "tenantMember",
    data: {
      tenantId,
      userId,
      role: "owner",
      createdAt: new Date(),
    },
  });
}

/**
 * Tenant ids the platform user can see (membership + legacy ownerId).
 */
export async function listAccessibleTenantIds(
  ctx: GenericEndpointContext,
  userId: string,
): Promise<string[]> {
  const [memberships, owned] = await Promise.all([
    ctx.context.adapter.findMany<TenantMember>({
      model: "tenantMember",
      where: [{ field: "userId", value: userId }],
    }),
    ctx.context.adapter.findMany<Tenant>({
      model: "tenant",
      where: [{ field: "ownerId", value: userId }],
    }),
  ]);

  return [
    ...new Set([
      ...memberships.map((m: TenantMember) => m.tenantId),
      ...owned.map((t: Tenant) => t.id),
    ]),
  ];
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

/**
 * Returns true when an adapter error looks like a unique constraint
 * violation (used to map races to USER_ALREADY_EXISTS).
 */
export function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String((error as { message: unknown }).message) : "";
  const code = "code" in error ? String((error as { code: unknown }).code) : "";
  return (
    /unique/i.test(message) ||
    code === "23505" ||
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    code === "ER_DUP_ENTRY"
  );
}
