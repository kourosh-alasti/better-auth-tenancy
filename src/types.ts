import type { GenericEndpointContext } from "@better-auth/core";
import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";
import type { Awaitable } from "better-auth";

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
   * Arbitrary JSON-serialized metadata.
   */
  metadata?: string | null | undefined;
  createdAt: Date;
  updatedAt: Date;
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
   * tenants. Set this to `true` to keep emails globall unique
   * (one email = one tenant).
   *
   * @default false
   */
  keepEmailGloballyUnique?: boolean | undefined;
  /**
   * Authorize tenant and OAuth-config management requests
   * (create/update/delete tenants and OAuth configs).
   *
   * When provided, this fully replaces the default check (which
   * requires an authenticated session). Return `false` to deny.
   */
  canManageTenants?: ((ctx: GenericEndpointContext) => Awaitable<boolean>) | undefined;
  /**
   * Custom schema for the plugin (rename models/fields).
   */
  schema?: BetterAuthPluginDBSchema | undefined;
}
