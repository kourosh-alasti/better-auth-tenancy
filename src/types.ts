import type { GenericEndpointContext } from "@better-auth/core";
import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";
import type { Awaitable } from "better-auth";

/**
 * Platform-user roles on a tenant (who may manage the tenant, not
 * end-users who authenticate under that tenant).
 *
 * Hierarchy: owner > admin > member
 */
export type TenantRole = "owner" | "admin" | "member";

/**
 * A tenant record.
 */
export interface Tenant {
  id: string;
  /**
   * Display name of the tenant.
   */
  name: string;
  /**
   * Unique, URL-friendly identifier for the tenant.
   */
  slug: string;
  /**
   * Primary platform owner. Set on create from the authenticated
   * session. Kept in sync with a `tenantMember` row of role `owner`.
   * `null` when created by a global admin without a session.
   */
  ownerId?: string | null | undefined;
  /**
   * Arbitrary JSON-serialized metadata.
   */
  metadata?: string | null | undefined;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A platform user membership on a tenant.
 */
export interface TenantMember {
  id: string;
  tenantId: string;
  userId: string;
  role: TenantRole;
  createdAt: Date;
}

/**
 * An invite for a tenant end-user to sign up via email.
 */
export interface TenantInvite {
  id: string;
  tenantId: string;
  email: string;
  token: string;
  /**
   * Platform user id of the admin/owner who created the invite.
   */
  invitedBy?: string | null | undefined;
  expiresAt: Date;
  consumedAt?: Date | null | undefined;
  revokedAt?: Date | null | undefined;
  createdAt: Date;
}

/**
 * A per-tenant OAuth provider configuration.
 */
export interface TenantOAuthConfig {
  id: string;
  tenantId: string;
  /**
   * The id of a built-in social provider (e.g. `google`, `github`).
   */
  providerId: string;
  /**
   * The OAuth client id, encrypted at rest with the auth secret.
   */
  clientId: string;
  /**
   * The OAuth client secret, encrypted at rest with the auth secret.
   * Never returned by the API.
   */
  clientSecret: string;
  /**
   * Comma-separated list of scopes to request from the provider.
   */
  scopes?: string | null | undefined;
  /**
   * Override the redirect URI for this provider.
   */
  redirectURI?: string | null | undefined;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantAuthOptions {
  /**
   * Custom resolver for the tenant id. Called before the default
   * resolution (request body, then the tenant header). Return a
   * falsy value to fall through to the default resolution.
   */
  resolveTenantId?:
    | ((ctx: GenericEndpointContext) => Awaitable<string | null | undefined>)
    | undefined;
  /**
   * The header to read the tenant id from when it isn't present in
   * the request body
   *
   * @default "x-tenant-id"
   */
  tenantHeader?: string | undefined;
  /**
   * By default the plugin removes the global unique constraint on
   * `user.email` so the same email can sign up under different
   * tenants. Set this to `true` to keep emails globally unique
   * (one email = one tenant).
   *
   * @default false
   */
  keepEmailGloballyUnique?: boolean | undefined;
  /**
   * Global admin bypass for tenant and OAuth-config management.
   *
   * When this returns `true`, the caller can manage every tenant.
   * When it returns `false` or is omitted, access falls through to
   * membership: a platform session (`user.tenantId` null) may create
   * tenants and manage those where they are a member with a sufficient
   * role.
   *
   * Use for operator API keys / super-admin checks.
   */
  canManageTenants?: ((ctx: GenericEndpointContext) => Awaitable<boolean>) | undefined;
  /**
   * Identifies platform-host requests (e.g. by comparing the request
   * host against your platform domain). Used by the session ↔ request
   * tenant-binding check: when this returns `true`, a session carrying
   * a tenant id is rejected, since tenant sessions must not be usable
   * on the platform host.
   *
   * Omit this if you don't need platform-host enforcement — tenant
   * mismatch enforcement (see `enforceSessionTenant`) still applies.
   */
  isPlatformRequest?: ((ctx: GenericEndpointContext) => Awaitable<boolean>) | undefined;
  /**
   * Enforces that an existing session matches the tenant (or platform)
   * context of the request it's used with:
   *
   * 1. If a tenant can be resolved for the request, the session's
   *    tenant id (`session.tenantId`, falling back to `user.tenantId`)
   *    must equal it.
   * 2. If `isPlatformRequest` resolves to `true`, the session must not
   *    carry a tenant id.
   * 3. If neither can be determined, nothing is enforced.
   *
   * Mismatches are rejected with `SESSION_TENANT_MISMATCH`. This
   * prevents a session issued under one tenant host (or the platform
   * host) from being replayed against another.
   *
   * @default true
   */
  enforceSessionTenant?: boolean | undefined;
  /**
   * Slugs that can never be used for a tenant, merged with the
   * plugin's built-in reserved list (`admin`, `api`, `www`, ...).
   * Useful for protecting app-specific routes or subdomains.
   */
  reservedSlugs?: string[] | undefined;
  /**
   * Expose `ownerId` and `metadata` on the public `GET /tenant/get`
   * endpoint. By default unauthorized callers only receive the safe
   * subset (`id`, `name`, `slug`, `createdAt`); members and global
   * admins always get the full record.
   *
   * @default false
   */
  exposeTenantDetailsPublicly?: boolean | undefined;
  /**
   * When `true`, OAuth credentials that cannot be decrypted are treated as
   * legacy plaintext values instead of failing. Use only while migrating
   * rows created before encryption was introduced.
   *
   * @default false
   */
  allowLegacyPlaintextCredentials?: boolean | undefined;
  /**
   * When `true`, new tenant end-user registration (email sign-up and
   * first-time social/OAuth sign-in) requires a valid, unconsumed invite
   * token matching the email. Existing users may still sign in without an
   * invite. Default: `false` (open sign-up).
   */
  requireInviteForTenantSignUp?: boolean | undefined;
  /**
   * Restrict new tenant end-user registration (email and first-time
   * social/OAuth) to these email domains when invite is not required.
   * Ignored when `requireInviteForTenantSignUp` is `true`. Pass a static
   * list or a per-tenant resolver.
   */
  allowedEmailDomains?:
    | string[]
    | ((tenantId: string, ctx: GenericEndpointContext) => Awaitable<string[]>)
    | undefined;
  /**
   * Custom schema for the plugin (rename models/fields).
   */
  schema?: BetterAuthPluginDBSchema | undefined;
}
