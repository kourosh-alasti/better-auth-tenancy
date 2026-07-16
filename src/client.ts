import type { tenantAuth } from ".";
import { TENANT_AUTH_ERROR_CODES } from "./error-codes";
import { PACKAGE_VERSION } from "./version";

export const tenantAuthClient = () => {
  return {
    id: "tenant-auth",
    version: PACKAGE_VERSION,
    $InferServerPlugin: {} as ReturnType<typeof tenantAuth>,
    pathMethods: {
      "/tenant/create": "POST",
      "/tenant/get": "GET",
      "/tenant/list": "GET",
      "/tenant/update": "POST",
      "/tenant/delete": "POST",
      "/tenant/member/add": "POST",
      "/tenant/member/list": "GET",
      "/tenant/member/update": "POST",
      "/tenant/member/remove": "POST",
      "/tenant/sign-up/email": "POST",
      "/tenant/sign-in/email": "POST",
      "/tenant/verify-email": "GET",
      "/tenant/sign-in/social": "POST",
      "/tenant/oauth-config/register": "POST",
      "/tenant/oauth-config/list": "GET",
      "/tenant/oauth-config/delete": "POST",
    } as const,
    atomListeners: [
      {
        matcher: (path: string) =>
          path === "/tenant/sign-in/email" ||
          path === "/tenant/sign-up/email" ||
          path === "/tenant/sign-in/social",
        signal: "$sessionSignal",
      },
    ],
    $ERROR_CODES: TENANT_AUTH_ERROR_CODES,
  };
};

export { TENANT_AUTH_ERROR_CODES } from "./error-codes";
export type {
  Tenant,
  TenantAuthOptions,
  TenantMember,
  TenantOAuthConfig,
  TenantRole,
} from "./types";
