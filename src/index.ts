import { mergeSchema } from "better-auth/db";
import { TENANT_AUTH_ERROR_CODES } from "./error-codes";
import { signInEmailTenant, signUpEmailTenant } from "./routes/email";
import {
  addTenantMember,
  listTenantMembers,
  removeTenantMember,
  updateTenantMember,
} from "./routes/members";
import {
  callbackTenantOAuth,
  deleteTenantOAuthConfig,
  listTenantOAuthConfigs,
  registerTenantOAuthConfig,
  signInSocialTenant,
} from "./routes/oauth";
import { createTenant, deleteTenant, getTenant, listTenants, updateTenant } from "./routes/tenants";
import { getSchema } from "./schema";
import type {
  Tenant,
  TenantAuthOptions,
  TenantMember,
  TenantOAuthConfig,
  TenantRole,
} from "./types";
import { PACKAGE_VERSION } from "./version";

declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    "tenant-auth": {
      creator: typeof tenantAuth;
    };
  }
}

export { TENANT_AUTH_ERROR_CODES } from "./error-codes";

/**
 * Multi-tenant authentication plugin for Better Auth.
 *
 * - Adds a `tenant` table and tenant management endpoints.
 * - Adds `tenantMember` for platform-user roles (owner / admin / member).
 * - Adds a `tenantId` column to the `user`, `session`, `account` and
 *   `verification` tables.
 * - Adds tenant-scoped sign-up / sign-in endpoints where the same email
 *   can exist as separate users under different tenants.
 * - Allows configuring OAuth credentials per tenant (stored in the
 *   database), falling back to the providers configured in the auth
 *   config.
 */
export const tenantAuth = (options?: TenantAuthOptions) => {
  return {
    id: "tenant-auth",
    version: PACKAGE_VERSION,
    endpoints: {
      createTenant: createTenant(options),
      getTenant: getTenant(),
      listTenants: listTenants(options),
      updateTenant: updateTenant(options),
      deleteTenant: deleteTenant(options),
      addTenantMember: addTenantMember(options),
      listTenantMembers: listTenantMembers(options),
      updateTenantMember: updateTenantMember(options),
      removeTenantMember: removeTenantMember(options),
      signUpEmailTenant: signUpEmailTenant(options),
      signInEmailTenant: signInEmailTenant(options),
      registerTenantOAuthConfig: registerTenantOAuthConfig(options),
      listTenantOAuthConfigs: listTenantOAuthConfigs(options),
      deleteTenantOAuthConfig: deleteTenantOAuthConfig(options),
      signInSocialTenant: signInSocialTenant(options),
      callbackTenantOAuth: callbackTenantOAuth(options),
    },
    schema: mergeSchema(getSchema(options), options?.schema),
    $ERROR_CODES: TENANT_AUTH_ERROR_CODES,
    options,
  };
};

export type { Tenant, TenantAuthOptions, TenantMember, TenantOAuthConfig, TenantRole };
