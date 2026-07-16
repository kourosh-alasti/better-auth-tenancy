import type { HookEndpointContext } from "@better-auth/core";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { mergeSchema } from "better-auth/db";
import { TENANT_AUTH_ERROR_CODES } from "./error-codes";
import { signInEmailTenant, signUpEmailTenant } from "./routes/email";
import {
  addTenantMember,
  listTenantMembers,
  removeTenantMember,
  updateTenantMember,
} from "./routes/members";
import { createTenantInvite, listTenantInvites, revokeTenantInvite } from "./routes/invites";
import {
  callbackTenantOAuth,
  deleteTenantOAuthConfig,
  listTenantOAuthConfigs,
  registerTenantOAuthConfig,
  signInSocialTenant,
} from "./routes/oauth";
import { createTenant, deleteTenant, getTenant, listTenants, updateTenant } from "./routes/tenants";
import { rejectTenantTokenOnCoreVerifyEmail, verifyEmailTenant } from "./routes/verify";
import { getSchema } from "./schema";
import type {
  Tenant,
  TenantAuthOptions,
  TenantInvite,
  TenantMember,
  TenantOAuthConfig,
  TenantRole,
} from "./types";
import { assertSessionMatchesRequest } from "./utils";
import { PACKAGE_VERSION } from "./version";

/**
 * Paths under `/tenant/` that manage tenants, members, or OAuth config
 * on behalf of a platform user or operator (authorized separately via
 * `resolveManagementAccess` / `assertCanManageTenant`). These accept a
 * *target* `tenantId` that is intentionally not the caller's own tenant
 * context, so they're excluded from session ↔ tenant binding enforcement.
 */
const TENANT_MANAGEMENT_PATHS = new Set<string>([
  "/tenant/create",
  "/tenant/get",
  "/tenant/list",
  "/tenant/update",
  "/tenant/delete",
  "/tenant/member/add",
  "/tenant/member/list",
  "/tenant/member/update",
  "/tenant/member/remove",
  "/tenant/invite/create",
  "/tenant/invite/list",
  "/tenant/invite/revoke",
  "/tenant/oauth-config/register",
  "/tenant/oauth-config/list",
  "/tenant/oauth-config/delete",
]);

/**
 * Requests worth checking for session ↔ tenant binding: tenant end-user
 * auth (`/tenant/sign-*`, `/tenant/callback/*`) and the core session
 * endpoint. Cheap to evaluate; the handler itself is a no-op when the
 * request has no session.
 */
function isSessionBindingPath(path: string): boolean {
  if (path === "/get-session") return true;
  if (!path.startsWith("/tenant/")) return false;
  return !TENANT_MANAGEMENT_PATHS.has(path);
}

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
      getTenant: getTenant(options),
      listTenants: listTenants(options),
      updateTenant: updateTenant(options),
      deleteTenant: deleteTenant(options),
      addTenantMember: addTenantMember(options),
      listTenantMembers: listTenantMembers(options),
      updateTenantMember: updateTenantMember(options),
      removeTenantMember: removeTenantMember(options),
      createTenantInvite: createTenantInvite(options),
      listTenantInvites: listTenantInvites(options),
      revokeTenantInvite: revokeTenantInvite(options),
      signUpEmailTenant: signUpEmailTenant(options),
      signInEmailTenant: signInEmailTenant(options),
      verifyEmailTenant: verifyEmailTenant(options),
      registerTenantOAuthConfig: registerTenantOAuthConfig(options),
      listTenantOAuthConfigs: listTenantOAuthConfigs(options),
      deleteTenantOAuthConfig: deleteTenantOAuthConfig(options),
      signInSocialTenant: signInSocialTenant(options),
      callbackTenantOAuth: callbackTenantOAuth(options),
    },
    hooks: {
      before: [
        {
          matcher: (ctx: HookEndpointContext) => ctx.path === "/verify-email",
          handler: rejectTenantTokenOnCoreVerifyEmail(),
        },
        {
          matcher: (ctx: HookEndpointContext) =>
            options?.enforceSessionTenant !== false && isSessionBindingPath(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx, { disableRefresh: true });
            if (!session) return;
            await assertSessionMatchesRequest(
              ctx,
              session as {
                session: { tenantId?: string | null };
                user: { tenantId?: string | null };
              },
              options,
            );
          }),
        },
      ],
    },
    schema: mergeSchema(getSchema(options), options?.schema),
    $ERROR_CODES: TENANT_AUTH_ERROR_CODES,
    options,
  };
};

export type {
  Tenant,
  TenantAuthOptions,
  TenantInvite,
  TenantMember,
  TenantOAuthConfig,
  TenantRole,
};
