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
  TenantInvite,
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
 * Decrypts an OAuth credential stored at rest. Fails explicitly unless
 * `allowLegacyPlaintextCredentials` is enabled for migration.
 */
export async function decryptCredential(
  ctx: GenericEndpointContext,
  value: string,
  options?: TenantAuthOptions,
): Promise<string> {
  try {
    return await symmetricDecrypt({
      key: ctx.context.secretConfig,
      data: value,
    });
  } catch {
    if (options?.allowLegacyPlaintextCredentials) {
      return value;
    }
    throw APIError.from(
      "INTERNAL_SERVER_ERROR",
      TENANT_AUTH_ERROR_CODES.OAUTH_CREDENTIAL_DECRYPT_FAILED,
    );
  }
}

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;

export type PaginatedList<T> = {
  data: T[];
  total: number;
  nextOffset?: number;
};

type ListWhere = NonNullable<
  Parameters<GenericEndpointContext["context"]["adapter"]["findMany"]>[0]
>["where"];

function isPaginatedRequest(limit?: number, offset?: number): boolean {
  return limit !== undefined || (offset !== undefined && offset > 0);
}

/**
 * Lists records with optional limit/offset pagination. When no pagination
 * params are provided, returns a plain array for backward compatibility.
 */
export async function listWithPagination<T>(
  ctx: GenericEndpointContext,
  args: {
    model: string;
    where?: ListWhere;
    limit?: number;
    offset?: number;
    sortBy?: { field: string; direction: "asc" | "desc" };
  },
): Promise<T[] | PaginatedList<T>> {
  const offset = args.offset ?? 0;
  const paginated = isPaginatedRequest(args.limit, offset);

  if (!paginated) {
    return await ctx.context.adapter.findMany<T>({
      model: args.model,
      where: args.where,
      sortBy: args.sortBy,
    });
  }

  const limit = args.limit ?? DEFAULT_LIST_LIMIT;
  const [data, total] = await Promise.all([
    ctx.context.adapter.findMany<T>({
      model: args.model,
      where: args.where,
      limit,
      offset,
      sortBy: args.sortBy,
    }),
    ctx.context.adapter.count({
      model: args.model,
      where: args.where,
    }),
  ]);

  const nextOffset = offset + data.length < total ? offset + limit : undefined;
  return {
    data,
    total,
    ...(nextOffset !== undefined ? { nextOffset } : {}),
  };
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
 * Resolves the tenant id from the request like `resolveTenantId`, but
 * returns `null` instead of throwing when none can be determined.
 */
export async function tryResolveTenantId(
  ctx: GenericEndpointContext,
  options?: TenantAuthOptions,
): Promise<string | null> {
  try {
    return await resolveTenantId(ctx, options);
  } catch {
    return null;
  }
}

type SessionWithTenant = {
  session?: { tenantId?: string | null | undefined } | null | undefined;
  user?: { tenantId?: string | null | undefined } | null | undefined;
};

/**
 * Enforces that an existing session matches the tenant (or platform)
 * context of the request it's being used with:
 *
 * 1. If a tenant can be resolved for the request, the session's tenant
 *    id (`session.session.tenantId`, falling back to
 *    `session.user.tenantId`) must equal it — otherwise the session
 *    belongs to a different tenant host.
 * 2. Else, if `options.isPlatformRequest` resolves to `true`, the
 *    session must not carry a tenant id — tenant sessions can't be
 *    reused on the platform host.
 * 3. If neither can be determined, nothing is enforced (backward
 *    compatible).
 */
export async function assertSessionMatchesRequest(
  ctx: GenericEndpointContext,
  session: SessionWithTenant,
  options?: TenantAuthOptions,
): Promise<void> {
  const sessionTenantId = session.session?.tenantId ?? session.user?.tenantId ?? null;

  const requestTenantId = await tryResolveTenantId(ctx, options);
  if (requestTenantId) {
    if (sessionTenantId !== requestTenantId) {
      throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.SESSION_TENANT_MISMATCH);
    }
    return;
  }

  if (options?.isPlatformRequest && sessionTenantId) {
    const isPlatform = await options.isPlatformRequest(ctx);
    if (isPlatform) {
      throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.SESSION_TENANT_MISMATCH);
    }
  }
}

/**
 * Validates a redirect-style URL (`callbackURL`, `newUserCallbackURL`,
 * `errorCallbackURL`, ...) against Better Auth's `trustedOrigins`
 * configuration.
 *
 * No-ops when `url` is falsy so callers can pass optional fields
 * directly. Relative paths (e.g. `/dashboard`) are always allowed.
 * Throws a `FORBIDDEN` `APIError` (mirroring Better Auth's own
 * `INVALID_CALLBACK_URL`) when the URL isn't trusted.
 */
export function assertTrustedRedirectURL(
  ctx: GenericEndpointContext,
  url: string | null | undefined,
  label = "callbackURL",
): void {
  if (!url) return;
  if (!ctx.context.isTrustedOrigin(url, { allowRelativePaths: true })) {
    ctx.context.logger.error(`Invalid ${label}: ${url}`);
    throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.INVALID_CALLBACK_URL);
  }
}

/**
 * Slug format: 2-63 chars, lowercase letters / digits / hyphens, no
 * leading or trailing hyphen. Mirrors DNS-label rules so slugs are safe
 * for subdomains (`shop.app.com`) and path segments (`/t/shop`).
 */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Slugs that would collide with common app/infrastructure routes and
 * subdomains. Extend via `options.reservedSlugs`.
 */
const DEFAULT_RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  "blog",
  "dashboard",
  "docs",
  "help",
  "internal",
  "login",
  "logout",
  "mail",
  "platform",
  "settings",
  "sign-in",
  "sign-up",
  "signin",
  "signup",
  "static",
  "status",
  "support",
  "tenant",
  "tenants",
  "www",
]);

/**
 * Validates a tenant slug's format and rejects reserved values.
 * Throws `INVALID_SLUG` / `SLUG_RESERVED`.
 */
export function assertValidSlug(slug: string, options?: TenantAuthOptions): void {
  if (slug.length < 2 || !SLUG_PATTERN.test(slug)) {
    throw APIError.from("BAD_REQUEST", TENANT_AUTH_ERROR_CODES.INVALID_SLUG);
  }
  if (DEFAULT_RESERVED_SLUGS.has(slug) || options?.reservedSlugs?.includes(slug)) {
    throw APIError.from("UNPROCESSABLE_ENTITY", TENANT_AUTH_ERROR_CODES.SLUG_RESERVED);
  }
}

/**
 * Public projection of a tenant for unauthorized callers: excludes
 * `ownerId` and `metadata` (which may hold private data like plan or
 * billing details).
 */
export function toPublicTenant(tenant: Tenant): Pick<Tenant, "id" | "name" | "slug" | "createdAt"> {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    createdAt: tenant.createdAt,
  };
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
 * Non-throwing probe used by the public `GET /tenant/get` endpoint:
 * `true` when the caller is a global admin (`canManageTenants`) or a
 * platform user with any role on the tenant.
 */
export async function canViewTenantDetails(
  ctx: GenericEndpointContext,
  tenant: Tenant,
  options?: TenantAuthOptions,
): Promise<boolean> {
  if (options?.canManageTenants && (await options.canManageTenants(ctx))) {
    return true;
  }
  const session = await getSessionFromCtx(ctx);
  const user = session?.user as SessionUser | undefined;
  if (!user || user.tenantId) {
    return false;
  }
  return (await resolveTenantRole(ctx, tenant, user.id)) !== null;
}

type TenantAdapter = GenericEndpointContext["context"]["adapter"];

function getAdapterTransaction(
  adapter: TenantAdapter,
): (<T>(fn: (trx: TenantAdapter) => Promise<T>) => Promise<T>) | null {
  const transaction = (adapter as { transaction?: unknown }).transaction;
  if (typeof transaction !== "function") return null;
  return transaction as <T>(fn: (trx: TenantAdapter) => Promise<T>) => Promise<T>;
}

function compareTenantMembers(a: TenantMember, b: TenantMember): number {
  const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreatedAt !== 0) return byCreatedAt;
  return a.userId.localeCompare(b.userId);
}

/**
 * Lists owner memberships for a tenant in deterministic order (createdAt,
 * then userId). Membership role is the source of truth for ownership.
 */
export async function listOwnerMembers(
  ctx: GenericEndpointContext,
  tenantId: string,
): Promise<TenantMember[]> {
  const owners = await ctx.context.adapter.findMany<TenantMember>({
    model: "tenantMember",
    where: [
      { field: "tenantId", value: tenantId },
      { field: "role", value: "owner" },
    ],
  });
  return owners.sort(compareTenantMembers);
}

/**
 * Blocks demoting or removing the last owner of a tenant.
 */
export async function assertNotLastOwner(
  ctx: GenericEndpointContext,
  tenantId: string,
): Promise<void> {
  const owners = await listOwnerMembers(ctx, tenantId);
  if (owners.length <= 1) {
    throw APIError.from("BAD_REQUEST", TENANT_AUTH_ERROR_CODES.CANNOT_REMOVE_LAST_OWNER);
  }
}

/**
 * Keeps `tenant.ownerId` in sync with owner memberships. Picks the earliest
 * owner membership (createdAt, then userId) or null when none remain.
 */
export async function syncTenantOwnerId(
  ctx: GenericEndpointContext,
  tenantId: string,
): Promise<void> {
  const owners = await listOwnerMembers(ctx, tenantId);
  await ctx.context.adapter.update<Tenant>({
    model: "tenant",
    where: [{ field: "id", value: tenantId }],
    update: {
      ownerId: owners[0]?.userId ?? null,
      updatedAt: new Date(),
    },
  });
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
 * Creates a tenant and, when `ownerUserId` is set, an owner membership
 * atomically. Uses an adapter transaction when available; otherwise rolls
 * back tenant creation if membership creation fails.
 */
export async function createTenantWithOwner(
  ctx: GenericEndpointContext,
  data: Omit<Tenant, "id">,
  ownerUserId: string | null,
): Promise<Tenant> {
  const adapter = ctx.context.adapter;
  const transaction = getAdapterTransaction(adapter);

  if (ownerUserId && transaction) {
    return await transaction(async (trx: TenantAdapter) => {
      const tenant = (await trx.create({
        model: "tenant",
        data: { ...data, ownerId: ownerUserId },
      })) as Tenant;
      await trx.create({
        model: "tenantMember",
        data: {
          tenantId: tenant.id,
          userId: ownerUserId,
          role: "owner",
          createdAt: new Date(),
        },
      });
      return tenant;
    });
  }

  const tenant = await ctx.context.adapter.create<Omit<Tenant, "id">, Tenant>({
    model: "tenant",
    data,
  });

  if (!ownerUserId) {
    return tenant;
  }

  try {
    await createOwnerMembership(ctx, tenant.id, ownerUserId);
  } catch (error) {
    try {
      await ctx.context.adapter.delete({
        model: "tenant",
        where: [{ field: "id", value: tenant.id }],
      });
    } catch (rollbackError) {
      ctx.context.logger.error("Failed to rollback tenant after owner membership creation failed", {
        tenantId: tenant.id,
        error: rollbackError,
      });
    }
    throw error;
  }

  return tenant;
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
  options?: TenantAuthOptions,
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
      clientId: await decryptCredential(ctx, config.clientId, options),
      clientSecret: await decryptCredential(ctx, config.clientSecret, options),
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

export function getEmailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at === -1) return "";
  return email.slice(at + 1).toLowerCase();
}

export async function resolveAllowedEmailDomains(
  ctx: GenericEndpointContext,
  options: TenantAuthOptions | undefined,
  tenantId: string,
): Promise<string[] | null> {
  const configured = options?.allowedEmailDomains;
  if (!configured) return null;
  const domains = typeof configured === "function" ? await configured(tenantId, ctx) : configured;
  return domains.map((domain) => domain.toLowerCase());
}

function assertInviteValid(invite: TenantInvite, tenantId: string, email: string): void {
  if (invite.tenantId !== tenantId) {
    throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.INVITE_INVALID);
  }
  if (invite.revokedAt) {
    throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.INVITE_INVALID);
  }
  if (invite.consumedAt) {
    throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.INVITE_INVALID);
  }
  if (invite.expiresAt < new Date()) {
    throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.INVITE_EXPIRED);
  }
  if (invite.email.toLowerCase() !== email) {
    throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.INVITE_INVALID);
  }
}

export async function findTenantInviteByToken(
  ctx: GenericEndpointContext,
  token: string,
): Promise<TenantInvite | null> {
  return await ctx.context.adapter.findOne<TenantInvite>({
    model: "tenantInvite",
    where: [{ field: "token", value: token }],
  });
}

export async function validateTenantSignUpInvite(
  ctx: GenericEndpointContext,
  tenantId: string,
  email: string,
  inviteToken: string,
): Promise<TenantInvite> {
  const invite = await findTenantInviteByToken(ctx, inviteToken);
  if (!invite) {
    throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.INVITE_INVALID);
  }
  assertInviteValid(invite, tenantId, email);
  return invite;
}

export async function assertTenantSignUpAllowed(
  ctx: GenericEndpointContext,
  options: TenantAuthOptions | undefined,
  tenant: Tenant,
  email: string,
  inviteToken?: string,
): Promise<TenantInvite | null> {
  const normalizedEmail = email.toLowerCase();

  if (options?.requireInviteForTenantSignUp) {
    if (!inviteToken) {
      throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.INVITE_REQUIRED);
    }
    return await validateTenantSignUpInvite(ctx, tenant.id, normalizedEmail, inviteToken);
  }

  const allowedDomains = await resolveAllowedEmailDomains(ctx, options, tenant.id);
  if (allowedDomains && allowedDomains.length > 0) {
    const domain = getEmailDomain(normalizedEmail);
    if (!allowedDomains.includes(domain)) {
      throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.EMAIL_DOMAIN_NOT_ALLOWED);
    }
  }

  return null;
}

export async function consumeTenantInvite(
  ctx: GenericEndpointContext,
  invite: TenantInvite,
): Promise<void> {
  await ctx.context.adapter.update<TenantInvite>({
    model: "tenantInvite",
    where: [{ field: "id", value: invite.id }],
    update: { consumedAt: new Date() },
  });
}

export function isPendingTenantInvite(invite: TenantInvite): boolean {
  if (invite.consumedAt || invite.revokedAt) return false;
  return invite.expiresAt >= new Date();
}
