import { parseSetCookieHeader } from "better-auth/cookies";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vite-plus/test";

import { tenantAuth } from "../src/index";
import { tenantAuthClient } from "../src/client";

const providerMocks = vi.hoisted(() => ({
  validateAuthorizationCode: vi.fn(),
  getUserInfo: vi.fn(),
}));

vi.mock("@better-auth/core/social-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@better-auth/core/social-providers")>();
  return {
    ...actual,
    socialProviders: {
      ...actual.socialProviders,
      google: (options: Parameters<typeof actual.google>[0]) => {
        const provider = actual.google(options);
        return {
          ...provider,
          validateAuthorizationCode: providerMocks.validateAuthorizationCode,
          getUserInfo: providerMocks.getUserInfo,
        };
      },
    },
  };
});

describe("tenant-auth", async () => {
  const { auth, client, sessionSetter, customFetchImpl } = await getTestInstance(
    {
      emailAndPassword: {
        enabled: true,
      },
      socialProviders: {
        google: {
          clientId: "global-client-id",
          clientSecret: "global-client-secret",
        },
      },
      plugins: [
        tenantAuth({
          canManageTenants: (ctx) => ctx.headers?.get("x-admin") === "1",
        }),
      ],
    },
    {
      clientOptions: {
        plugins: [tenantAuthClient()],
      },
    },
  );

  const adminHeaders = new Headers({ "x-admin": "1" });

  const tenantA = await auth.api.createTenant({
    body: { name: "Tenant A", slug: "tenant-a" },
    headers: adminHeaders,
  });
  const tenantB = await auth.api.createTenant({
    body: { name: "Tenant B", slug: "tenant-b" },
    headers: adminHeaders,
  });

  describe("tenant management", () => {
    it("should create tenants", async () => {
      expect(tenantA.id).toBeDefined();
      expect(tenantA.slug).toBe("tenant-a");
      expect(tenantB.slug).toBe("tenant-b");
      // Global admin (API key) creates without a session → no owner.
      expect(tenantA.ownerId ?? null).toBeNull();
    });

    it("should reject duplicate slugs", async () => {
      await expect(
        auth.api.createTenant({
          body: { name: "Tenant A2", slug: "tenant-a" },
          headers: adminHeaders,
        }),
      ).rejects.toMatchObject({
        body: { code: "TENANT_ALREADY_EXISTS" },
      });
    });

    it("should deny management without authorization", async () => {
      await expect(
        auth.api.createTenant({
          body: { name: "Nope", slug: "nope" },
        }),
      ).rejects.toMatchObject({
        body: { code: "TENANT_MANAGEMENT_NOT_ALLOWED" },
      });
    });

    it("should get a tenant by slug", async () => {
      const tenant = await auth.api.getTenant({
        query: { slug: "tenant-a" },
      });
      expect(tenant.id).toBe(tenantA.id);
    });

    it("should update a tenant", async () => {
      const updated = await auth.api.updateTenant({
        body: { id: tenantA.id, data: { name: "Tenant A Renamed" } },
        headers: adminHeaders,
      });
      expect(updated.name).toBe("Tenant A Renamed");
    });

    it("should list tenants", async () => {
      const tenants = await auth.api.listTenants({
        headers: adminHeaders,
      });
      expect(tenants.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("tenant ownership", () => {
    const ownerHeaders = new Headers();
    const otherHeaders = new Headers();
    let ownedTenant: { id: string; slug: string; ownerId?: string | null };

    it("should let a platform user create and own a tenant", async () => {
      const ownerSignUp = await auth.api.signUpEmail({
        body: {
          name: "Platform Owner",
          email: "owner@platform.com",
          password: "owner-password",
        },
        returnHeaders: true,
      });
      expect(ownerSignUp.response.user.id).toBeDefined();
      expect(
        (
          ownerSignUp.response.user as typeof ownerSignUp.response.user & {
            tenantId?: string | null;
          }
        ).tenantId ?? null,
      ).toBeNull();

      const ownerCookies = parseSetCookieHeader(ownerSignUp.headers.get("set-cookie") || "");
      for (const [name, { value }] of ownerCookies.entries()) {
        ownerHeaders.append("cookie", `${name}=${value}`);
      }

      ownedTenant = await auth.api.createTenant({
        body: { name: "Owned", slug: "owned-tenant" },
        headers: ownerHeaders,
      });
      expect(ownedTenant.ownerId).toBe(ownerSignUp.response.user.id);

      const members = await auth.api.listTenantMembers({
        query: { tenantId: ownedTenant.id },
        headers: ownerHeaders,
      });
      expect(members).toHaveLength(1);
      expect(members[0]!.userId).toBe(ownerSignUp.response.user.id);
      expect(members[0]!.role).toBe("owner");
    });

    it("should list only owned tenants for a platform user", async () => {
      const tenants = await auth.api.listTenants({ headers: ownerHeaders });
      expect(tenants.every((t) => t.ownerId === ownedTenant.ownerId)).toBe(true);
      expect(tenants.some((t) => t.id === ownedTenant.id)).toBe(true);
      expect(tenants.some((t) => t.id === tenantA.id)).toBe(false);
    });

    it("should let the owner update their tenant", async () => {
      const updated = await auth.api.updateTenant({
        body: { id: ownedTenant.id, data: { name: "Owned Renamed" } },
        headers: ownerHeaders,
      });
      expect(updated.name).toBe("Owned Renamed");
    });

    it("should deny another platform user from managing a tenant they do not own", async () => {
      const otherSignUp = await auth.api.signUpEmail({
        body: {
          name: "Other Platform",
          email: "other@platform.com",
          password: "other-password",
        },
        returnHeaders: true,
      });
      const otherCookies = parseSetCookieHeader(otherSignUp.headers.get("set-cookie") || "");
      for (const [name, { value }] of otherCookies.entries()) {
        otherHeaders.append("cookie", `${name}=${value}`);
      }

      await expect(
        auth.api.updateTenant({
          body: { id: ownedTenant.id, data: { name: "Hijacked" } },
          headers: otherHeaders,
        }),
      ).rejects.toMatchObject({
        body: { code: "TENANT_NOT_OWNED" },
      });

      await expect(
        auth.api.deleteTenant({
          body: { id: ownedTenant.id },
          headers: otherHeaders,
        }),
      ).rejects.toMatchObject({
        body: { code: "TENANT_NOT_OWNED" },
      });

      await expect(
        auth.api.registerTenantOAuthConfig({
          body: {
            tenantId: ownedTenant.id,
            providerId: "google",
            clientId: "stolen",
            clientSecret: "stolen",
          },
          headers: otherHeaders,
        }),
      ).rejects.toMatchObject({
        body: { code: "TENANT_NOT_OWNED" },
      });
    });

    it("should deny tenant end-users from creating tenants", async () => {
      const tenantUser = await auth.api.signUpEmailTenant({
        body: {
          tenantId: tenantA.id,
          name: "Tenant User",
          email: "enduser@example.com",
          password: "enduser-password",
        },
        returnHeaders: true,
      });
      const cookies = parseSetCookieHeader(tenantUser.headers.get("set-cookie") || "");
      const endUserHeaders = new Headers();
      for (const [name, { value }] of cookies.entries()) {
        endUserHeaders.append("cookie", `${name}=${value}`);
      }

      await expect(
        auth.api.createTenant({
          body: { name: "Should Fail", slug: "should-fail" },
          headers: endUserHeaders,
        }),
      ).rejects.toMatchObject({
        body: { code: "TENANT_MANAGEMENT_NOT_ALLOWED" },
      });
    });

    it("should let the owner delete their tenant", async () => {
      await auth.api.deleteTenant({
        body: { id: ownedTenant.id },
        headers: ownerHeaders,
      });
      await expect(auth.api.getTenant({ query: { id: ownedTenant.id } })).rejects.toMatchObject({
        body: { code: "TENANT_NOT_FOUND" },
      });
    });
  });

  describe("tenant membership RBAC", () => {
    const ownerHeaders = new Headers();
    const adminHeadersLocal = new Headers();
    const memberHeaders = new Headers();
    let rbacTenant: { id: string };
    let ownerUserId: string;
    let adminUserId: string;
    let memberUserId: string;

    it("should set up owner, admin, and member", async () => {
      const owner = await auth.api.signUpEmail({
        body: {
          name: "RBAC Owner",
          email: "rbac-owner@platform.com",
          password: "password",
        },
        returnHeaders: true,
      });
      ownerUserId = owner.response.user.id;
      for (const [name, { value }] of parseSetCookieHeader(
        owner.headers.get("set-cookie") || "",
      ).entries()) {
        ownerHeaders.append("cookie", `${name}=${value}`);
      }

      rbacTenant = await auth.api.createTenant({
        body: { name: "RBAC Co", slug: "rbac-co" },
        headers: ownerHeaders,
      });

      const admin = await auth.api.signUpEmail({
        body: {
          name: "RBAC Admin",
          email: "rbac-admin@platform.com",
          password: "password",
        },
        returnHeaders: true,
      });
      adminUserId = admin.response.user.id;
      for (const [name, { value }] of parseSetCookieHeader(
        admin.headers.get("set-cookie") || "",
      ).entries()) {
        adminHeadersLocal.append("cookie", `${name}=${value}`);
      }

      const member = await auth.api.signUpEmail({
        body: {
          name: "RBAC Member",
          email: "rbac-member@platform.com",
          password: "password",
        },
        returnHeaders: true,
      });
      memberUserId = member.response.user.id;
      for (const [name, { value }] of parseSetCookieHeader(
        member.headers.get("set-cookie") || "",
      ).entries()) {
        memberHeaders.append("cookie", `${name}=${value}`);
      }

      await auth.api.addTenantMember({
        body: { tenantId: rbacTenant.id, userId: adminUserId, role: "admin" },
        headers: ownerHeaders,
      });
      await auth.api.addTenantMember({
        body: {
          tenantId: rbacTenant.id,
          email: "rbac-member@platform.com",
          role: "member",
        },
        headers: ownerHeaders,
      });
    });

    it("should let an admin update the tenant but not delete it", async () => {
      const updated = await auth.api.updateTenant({
        body: { id: rbacTenant.id, data: { name: "RBAC Co Renamed" } },
        headers: adminHeadersLocal,
      });
      expect(updated.name).toBe("RBAC Co Renamed");

      await expect(
        auth.api.deleteTenant({
          body: { id: rbacTenant.id },
          headers: adminHeadersLocal,
        }),
      ).rejects.toMatchObject({
        body: { code: "TENANT_MANAGEMENT_NOT_ALLOWED" },
      });
    });

    it("should let members list members but not update the tenant", async () => {
      const members = await auth.api.listTenantMembers({
        query: { tenantId: rbacTenant.id },
        headers: memberHeaders,
      });
      expect(members.length).toBe(3);

      await expect(
        auth.api.updateTenant({
          body: { id: rbacTenant.id, data: { name: "Nope" } },
          headers: memberHeaders,
        }),
      ).rejects.toMatchObject({
        body: { code: "TENANT_MANAGEMENT_NOT_ALLOWED" },
      });
    });

    it("should prevent admins from adding owners", async () => {
      const extra = await auth.api.signUpEmail({
        body: {
          name: "Extra",
          email: "rbac-extra@platform.com",
          password: "password",
        },
      });
      await expect(
        auth.api.addTenantMember({
          body: {
            tenantId: rbacTenant.id,
            userId: extra.user.id,
            role: "owner",
          },
          headers: adminHeadersLocal,
        }),
      ).rejects.toMatchObject({
        body: { code: "TENANT_MANAGEMENT_NOT_ALLOWED" },
      });
    });

    it("should list the tenant for all members", async () => {
      const forMember = await auth.api.listTenants({ headers: memberHeaders });
      expect(forMember.some((t) => t.id === rbacTenant.id)).toBe(true);
    });

    it("should prevent removing the last owner", async () => {
      await expect(
        auth.api.removeTenantMember({
          body: { tenantId: rbacTenant.id, userId: ownerUserId },
          headers: ownerHeaders,
        }),
      ).rejects.toMatchObject({
        body: { code: "CANNOT_REMOVE_LAST_OWNER" },
      });
    });

    it("should let the owner remove a member", async () => {
      await auth.api.removeTenantMember({
        body: { tenantId: rbacTenant.id, userId: memberUserId },
        headers: ownerHeaders,
      });
      const members = await auth.api.listTenantMembers({
        query: { tenantId: rbacTenant.id },
        headers: ownerHeaders,
      });
      expect(members.some((m) => m.userId === memberUserId)).toBe(false);
    });
  });

  describe("tenant scoped email sign-up / sign-in", () => {
    const email = "shared@example.com";

    it("should sign up a user under a tenant", async () => {
      const res = await auth.api.signUpEmailTenant({
        body: {
          tenantId: tenantA.id,
          name: "User A",
          email,
          password: "password-a",
        },
      });
      expect(res.token).toBeDefined();
      expect(res.user.email).toBe(email);
      expect((res.user as typeof res.user & { tenantId?: string }).tenantId).toBe(tenantA.id);
    });

    it("should allow the same email under a different tenant", async () => {
      const res = await auth.api.signUpEmailTenant({
        body: {
          tenantId: tenantB.id,
          name: "User B",
          email,
          password: "password-b",
        },
      });
      expect(res.token).toBeDefined();
      expect((res.user as typeof res.user & { tenantId?: string }).tenantId).toBe(tenantB.id);
    });

    it("should reject duplicate email within the same tenant", async () => {
      await expect(
        auth.api.signUpEmailTenant({
          body: {
            tenantId: tenantA.id,
            name: "User A2",
            email,
            password: "password-x",
          },
        }),
      ).rejects.toMatchObject({
        body: { code: "USER_ALREADY_EXISTS" },
      });
    });

    it("should sign in scoped to the tenant", async () => {
      const res = await auth.api.signInEmailTenant({
        body: {
          tenantId: tenantA.id,
          email,
          password: "password-a",
        },
      });
      expect(res.token).toBeDefined();
      expect((res.user as typeof res.user & { tenantId?: string }).tenantId).toBe(tenantA.id);
    });

    it("should not sign in with another tenant's password", async () => {
      await expect(
        auth.api.signInEmailTenant({
          body: {
            tenantId: tenantB.id,
            email,
            password: "password-a",
          },
        }),
      ).rejects.toMatchObject({
        body: { code: "INVALID_EMAIL_OR_PASSWORD" },
      });
    });

    it("should fail for an unknown tenant", async () => {
      await expect(
        auth.api.signInEmailTenant({
          body: {
            tenantId: "does-not-exist",
            email,
            password: "password-a",
          },
        }),
      ).rejects.toMatchObject({
        body: { code: "TENANT_NOT_FOUND" },
      });
    });

    it("should require a tenant id", async () => {
      await expect(
        auth.api.signInEmailTenant({
          body: {
            email,
            password: "password-a",
          },
        }),
      ).rejects.toMatchObject({
        body: { code: "TENANT_ID_REQUIRED" },
      });
    });

    it("should resolve the tenant id from the header", async () => {
      const res = await auth.api.signInEmailTenant({
        body: {
          email,
          password: "password-a",
        },
        headers: new Headers({ "x-tenant-id": tenantA.id }),
      });
      expect(res.token).toBeDefined();
    });

    it("should store the tenant id on the session", async () => {
      const headers = new Headers();
      const res = await client.tenant.signIn.email(
        {
          tenantId: tenantA.id,
          email,
          password: "password-a",
        },
        {
          onSuccess: sessionSetter(headers),
        },
      );
      expect(res.data?.token).toBeDefined();
      const session = await auth.api.getSession({ headers });
      expect(session).toBeTruthy();
      expect((session!.session as { tenantId?: string }).tenantId).toBe(tenantA.id);
    });

    it("should reject an untrusted callbackURL on sign-in", async () => {
      await expect(
        auth.api.signInEmailTenant({
          body: {
            tenantId: tenantA.id,
            email,
            password: "password-a",
            callbackURL: "https://evil.example",
          },
        }),
      ).rejects.toMatchObject({
        body: { code: "INVALID_CALLBACK_URL" },
      });
    });

    it("should allow a relative callbackURL on sign-in and set Location", async () => {
      const { headers, response } = await auth.api.signInEmailTenant({
        body: {
          tenantId: tenantA.id,
          email,
          password: "password-a",
          callbackURL: "/dashboard",
        },
        returnHeaders: true,
      });
      expect(response.redirect).toBe(true);
      expect(response.url).toBe("/dashboard");
      expect(headers.get("location")).toBe("/dashboard");
    });

    it("should reject an untrusted callbackURL on sign-up", async () => {
      await expect(
        auth.api.signUpEmailTenant({
          body: {
            tenantId: tenantA.id,
            name: "Evil Redirect",
            email: "evil-redirect@example.com",
            password: "password-evil",
            callbackURL: "https://evil.example",
          },
        }),
      ).rejects.toMatchObject({
        body: { code: "INVALID_CALLBACK_URL" },
      });
    });
  });

  describe("session ↔ tenant binding", () => {
    const email = "shared@example.com";
    const tenantASessionHeaders = new Headers();

    it("should sign in under tenant A and capture the session", async () => {
      const { headers, response } = await auth.api.signInEmailTenant({
        body: { tenantId: tenantA.id, email, password: "password-a" },
        returnHeaders: true,
      });
      expect(response.token).toBeDefined();
      for (const [name, { value }] of parseSetCookieHeader(
        headers.get("set-cookie") || "",
      ).entries()) {
        tenantASessionHeaders.append("cookie", `${name}=${value}`);
      }
    });

    it("should deny reusing a tenant A session for a tenant B request (body tenantId)", async () => {
      await expect(
        auth.api.signInEmailTenant({
          body: { tenantId: tenantB.id, email, password: "password-b" },
          headers: tenantASessionHeaders,
        }),
      ).rejects.toMatchObject({
        body: { code: "SESSION_TENANT_MISMATCH" },
      });
    });

    it("should deny reusing a tenant A session for a tenant B request (x-tenant-id header)", async () => {
      const headers = new Headers(tenantASessionHeaders);
      headers.set("x-tenant-id", tenantB.id);
      await expect(auth.api.getSession({ headers })).rejects.toMatchObject({
        body: { code: "SESSION_TENANT_MISMATCH" },
      });
    });

    it("should allow the tenant A session for its own tenant", async () => {
      const headers = new Headers(tenantASessionHeaders);
      headers.set("x-tenant-id", tenantA.id);
      const session = await auth.api.getSession({ headers });
      expect(session).toBeTruthy();
      expect((session!.session as { tenantId?: string }).tenantId).toBe(tenantA.id);
    });

    it("should allow a platform session (null tenantId) to manage a tenant by id", async () => {
      const owner = await auth.api.signUpEmail({
        body: {
          name: "Binding Owner",
          email: "binding-owner@platform.com",
          password: "password",
        },
        returnHeaders: true,
      });
      const ownerHeaders = new Headers();
      for (const [name, { value }] of parseSetCookieHeader(
        owner.headers.get("set-cookie") || "",
      ).entries()) {
        ownerHeaders.append("cookie", `${name}=${value}`);
      }

      // Create is a platform-only endpoint (no target tenantId in the
      // request), so it's never affected by session ↔ tenant binding.
      const tenant = await auth.api.createTenant({
        body: { name: "Binding Co", slug: "binding-co" },
        headers: ownerHeaders,
      });

      // Member management passes a *target* tenantId while the caller's
      // own session has a null tenantId — this must keep working.
      const members = await auth.api.listTenantMembers({
        query: { tenantId: tenant.id },
        headers: ownerHeaders,
      });
      expect(members).toHaveLength(1);
      expect(members[0]!.userId).toBe(owner.response.user.id);
    });
  });

  describe("session ↔ tenant binding with isPlatformRequest", async () => {
    const { auth: boundAuth } = await getTestInstance(
      {
        emailAndPassword: { enabled: true },
        plugins: [
          tenantAuth({
            canManageTenants: () => true,
            isPlatformRequest: () => true,
          }),
        ],
      },
      {
        clientOptions: {
          plugins: [tenantAuthClient()],
        },
      },
    );

    it("should reject a tenant session on a request identified as platform-only", async () => {
      const tenant = await boundAuth.api.createTenant({
        body: { name: "Platform Bound", slug: "platform-bound" },
      });
      const signUp = await boundAuth.api.signUpEmailTenant({
        body: {
          tenantId: tenant.id,
          name: "Tenant End User",
          email: "enduser@platform-bound.com",
          password: "password",
        },
        returnHeaders: true,
      });
      const headers = new Headers();
      for (const [name, { value }] of parseSetCookieHeader(
        signUp.headers.get("set-cookie") || "",
      ).entries()) {
        headers.append("cookie", `${name}=${value}`);
      }

      await expect(boundAuth.api.getSession({ headers })).rejects.toMatchObject({
        body: { code: "SESSION_TENANT_MISMATCH" },
      });
    });
  });

  describe("per-tenant OAuth configuration", () => {
    it("should register an OAuth config for a tenant", async () => {
      const config = await auth.api.registerTenantOAuthConfig({
        body: {
          tenantId: tenantA.id,
          providerId: "google",
          clientId: "tenant-a-client-id",
          clientSecret: "tenant-a-client-secret",
        },
        headers: adminHeaders,
      });
      expect(config.tenantId).toBe(tenantA.id);
      expect(config.providerId).toBe("google");
      expect((config as typeof config & { clientSecret?: string }).clientSecret).toBeUndefined();
    });

    it("should encrypt credentials at rest", async () => {
      const ctx = await auth.$context;
      const stored = await ctx.adapter.findOne<{
        clientId: string;
        clientSecret: string;
      }>({
        model: "tenantOauthConfig",
        where: [
          { field: "tenantId", value: tenantA.id },
          { field: "providerId", value: "google" },
        ],
      });
      expect(stored).toBeTruthy();
      expect(stored!.clientId).not.toBe("tenant-a-client-id");
      expect(stored!.clientSecret).not.toBe("tenant-a-client-secret");
    });

    it("should list OAuth configs without secrets", async () => {
      const configs = await auth.api.listTenantOAuthConfigs({
        query: { tenantId: tenantA.id },
        headers: adminHeaders,
      });
      expect(configs.length).toBe(1);
      expect(configs[0]!.clientId).toBe("tenant-a-client-id");
      expect(
        (configs[0] as (typeof configs)[number] & { clientSecret?: string }).clientSecret,
      ).toBeUndefined();
    });

    it("should use the tenant's OAuth config for social sign-in", async () => {
      const res = await auth.api.signInSocialTenant({
        body: {
          tenantId: tenantA.id,
          provider: "google",
          callbackURL: "/dashboard",
          disableRedirect: true,
        },
      });
      expect(res.url).toBeDefined();
      const url = new URL(res.url!);
      expect(url.searchParams.get("client_id")).toBe("tenant-a-client-id");
      expect(url.searchParams.get("redirect_uri")).toContain("/tenant/callback/google");
    });

    it("should fall back to the global provider config", async () => {
      const res = await auth.api.signInSocialTenant({
        body: {
          tenantId: tenantB.id,
          provider: "google",
          callbackURL: "/dashboard",
          disableRedirect: true,
        },
      });
      expect(res.url).toBeDefined();
      const url = new URL(res.url!);
      expect(url.searchParams.get("client_id")).toBe("global-client-id");
    });

    it("should reject an untrusted errorCallbackURL on social sign-in", async () => {
      await expect(
        auth.api.signInSocialTenant({
          body: {
            tenantId: tenantA.id,
            provider: "google",
            callbackURL: "/dashboard",
            errorCallbackURL: "https://evil.example",
            disableRedirect: true,
          },
        }),
      ).rejects.toMatchObject({
        body: { code: "INVALID_CALLBACK_URL" },
      });
    });

    it("should update an existing OAuth config", async () => {
      const updated = await auth.api.registerTenantOAuthConfig({
        body: {
          tenantId: tenantA.id,
          providerId: "google",
          clientId: "tenant-a-client-id-v2",
          clientSecret: "tenant-a-client-secret-v2",
        },
        headers: adminHeaders,
      });
      expect(updated.clientId).toBe("tenant-a-client-id-v2");
      const configs = await auth.api.listTenantOAuthConfigs({
        query: { tenantId: tenantA.id },
        headers: adminHeaders,
      });
      expect(configs.length).toBe(1);
    });

    it("should error for a provider that isn't configured anywhere", async () => {
      await expect(
        auth.api.signInSocialTenant({
          body: {
            tenantId: tenantB.id,
            provider: "github",
            callbackURL: "/dashboard",
            disableRedirect: true,
          },
        }),
      ).rejects.toMatchObject({
        body: { code: "PROVIDER_NOT_FOUND" },
      });
    });

    it("should delete an OAuth config", async () => {
      await auth.api.deleteTenantOAuthConfig({
        body: { tenantId: tenantA.id, providerId: "google" },
        headers: adminHeaders,
      });
      const configs = await auth.api.listTenantOAuthConfigs({
        query: { tenantId: tenantA.id },
        headers: adminHeaders,
      });
      expect(configs.length).toBe(0);
    });
  });

  describe("tenant OAuth callback", () => {
    const runOAuthFlow = async () => {
      const { headers: signInHeaders, response: signInRes } = await auth.api.signInSocialTenant({
        body: {
          tenantId: tenantA.id,
          provider: "google",
          callbackURL: "/welcome",
          disableRedirect: true,
        },
        returnHeaders: true,
      });
      const state = new URL(signInRes.url!).searchParams.get("state")!;
      const cookies = parseSetCookieHeader(signInHeaders.get("set-cookie") || "");
      const cookieHeader = Array.from(cookies.entries())
        .map(([name, { value }]) => `${name}=${value}`)
        .join("; ");
      providerMocks.validateAuthorizationCode.mockResolvedValue({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
      });
      providerMocks.getUserInfo.mockResolvedValue({
        user: {
          id: "google-user-1",
          email: "OAuth-User@Example.com",
          name: "OAuth User",
          emailVerified: true,
        },
        data: {},
      });
      return await customFetchImpl(
        `http://localhost:3000/api/auth/tenant/callback/google?code=test-code&state=${encodeURIComponent(state)}`,
        {
          method: "GET",
          redirect: "manual",
          headers: { cookie: cookieHeader },
        },
      );
    };

    it("should create a tenant-scoped user through the callback", async () => {
      await auth.api.registerTenantOAuthConfig({
        body: {
          tenantId: tenantA.id,
          providerId: "google",
          clientId: "tenant-a-client-id",
          clientSecret: "tenant-a-client-secret",
        },
        headers: adminHeaders,
      });
      const response = await runOAuthFlow();
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/welcome");
      expect(response.headers.get("set-cookie")).toContain("better-auth.session_token");

      const ctx = await auth.$context;
      const user = await ctx.adapter.findOne<{
        id: string;
        email: string;
        tenantId: string;
      }>({
        model: "user",
        where: [
          { field: "email", value: "oauth-user@example.com" },
          { field: "tenantId", value: tenantA.id },
        ],
      });
      expect(user).toBeTruthy();
      expect(user!.tenantId).toBe(tenantA.id);

      const account = await ctx.adapter.findOne<{
        id: string;
        tenantId: string;
        accountId: string;
      }>({
        model: "account",
        where: [
          { field: "userId", value: user!.id },
          { field: "providerId", value: "google" },
        ],
      });
      expect(account).toBeTruthy();
      expect(account!.accountId).toBe("google-user-1");
      expect(account!.tenantId).toBe(tenantA.id);
    });

    it("should sign in the same OAuth account without duplicating the user", async () => {
      const response = await runOAuthFlow();
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/welcome");

      const ctx = await auth.$context;
      const users = await ctx.adapter.findMany<{ id: string }>({
        model: "user",
        where: [
          { field: "email", value: "oauth-user@example.com" },
          { field: "tenantId", value: tenantA.id },
        ],
      });
      expect(users.length).toBe(1);
    });
  });

  describe("tenant deletion", () => {
    it("should delete a tenant", async () => {
      const tenant = await auth.api.createTenant({
        body: { name: "Temp", slug: "temp" },
        headers: adminHeaders,
      });
      await auth.api.deleteTenant({
        body: { id: tenant.id },
        headers: adminHeaders,
      });
      await expect(auth.api.getTenant({ query: { id: tenant.id } })).rejects.toMatchObject({
        body: { code: "TENANT_NOT_FOUND" },
      });
    });
  });
});

describe("tenant-aware email verification", async () => {
  const sendVerificationEmail = vi.fn();

  const { auth: verifyAuth, customFetchImpl: verifyFetch } = await getTestInstance({
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url, token }) => {
        sendVerificationEmail({ email: user.email, url, token });
      },
    },
    plugins: [
      tenantAuth({
        canManageTenants: () => true,
      }),
    ],
  });

  const email = "verify-shared@example.com";
  let tenantX: { id: string };
  let tenantY: { id: string };
  let tokenX: string;
  let tokenY: string;

  it("should send tenant-scoped verification links (not core /verify-email) for both tenants", async () => {
    tenantX = await verifyAuth.api.createTenant({ body: { name: "Verify X", slug: "verify-x" } });
    tenantY = await verifyAuth.api.createTenant({ body: { name: "Verify Y", slug: "verify-y" } });

    sendVerificationEmail.mockClear();
    await verifyAuth.api.signUpEmailTenant({
      body: { tenantId: tenantX.id, name: "User X", email, password: "password-x" },
    });
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    const urlX = sendVerificationEmail.mock.calls[0]![0].url as string;
    expect(urlX).toContain("/tenant/verify-email?token=");
    tokenX = new URL(urlX).searchParams.get("token")!;
    expect(tokenX).toBeTruthy();

    sendVerificationEmail.mockClear();
    await verifyAuth.api.signUpEmailTenant({
      body: { tenantId: tenantY.id, name: "User Y", email, password: "password-y" },
    });
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    const urlY = sendVerificationEmail.mock.calls[0]![0].url as string;
    expect(urlY).toContain("/tenant/verify-email?token=");
    tokenY = new URL(urlY).searchParams.get("token")!;
    expect(tokenY).toBeTruthy();
    expect(tokenY).not.toBe(tokenX);
  });

  it("should verify only tenant X's user via /tenant/verify-email, leaving tenant Y's user untouched", async () => {
    const result = await verifyAuth.api.verifyEmailTenant({ query: { token: tokenX } });
    expect(result.status).toBe(true);

    const ctx = await verifyAuth.$context;
    const userX = await ctx.adapter.findOne<{ emailVerified: boolean }>({
      model: "user",
      where: [
        { field: "email", value: email },
        { field: "tenantId", value: tenantX.id },
      ],
    });
    const userY = await ctx.adapter.findOne<{ emailVerified: boolean }>({
      model: "user",
      where: [
        { field: "email", value: email },
        { field: "tenantId", value: tenantY.id },
      ],
    });
    expect(userX!.emailVerified).toBe(true);
    expect(userY!.emailVerified).toBe(false);
  });

  it("should reject a tenant verification token replayed against core /verify-email", async () => {
    await expect(verifyAuth.api.verifyEmail({ query: { token: tokenY } })).rejects.toMatchObject({
      body: { code: "INVALID_VERIFICATION_TOKEN" },
    });

    const ctx = await verifyAuth.$context;
    const userY = await ctx.adapter.findOne<{ emailVerified: boolean }>({
      model: "user",
      where: [
        { field: "email", value: email },
        { field: "tenantId", value: tenantY.id },
      ],
    });
    expect(userY!.emailVerified).toBe(false);
  });

  it("should redirect to callbackURL with an error when a tenant token hits core /verify-email", async () => {
    const response = await verifyFetch(
      `http://localhost:3000/api/auth/verify-email?token=${tokenY}&callbackURL=${encodeURIComponent("/after-verify")}`,
      { method: "GET", redirect: "manual" },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/after-verify?error=INVALID_VERIFICATION_TOKEN");
  });

  it("should reject a core verification token (no tenantId) at /tenant/verify-email", async () => {
    const coreVerifyEmail = vi.fn();
    const { auth: coreAuth } = await getTestInstance({
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
      },
      emailVerification: {
        sendOnSignUp: true,
        sendVerificationEmail: async ({ url }) => {
          coreVerifyEmail(url);
        },
      },
      plugins: [tenantAuth({ canManageTenants: () => true })],
    });

    // Discard the verification email sent for `getTestInstance`'s own
    // default test user before making the assertion below.
    coreVerifyEmail.mockClear();
    await coreAuth.api.signUpEmail({
      body: { name: "Platform User", email: "core-only@example.com", password: "password" },
    });
    expect(coreVerifyEmail).toHaveBeenCalledTimes(1);
    const coreURL = coreVerifyEmail.mock.calls[0]![0] as string;
    expect(coreURL).toContain("/verify-email?token=");
    const coreToken = new URL(coreURL).searchParams.get("token")!;

    await expect(
      coreAuth.api.verifyEmailTenant({ query: { token: coreToken } }),
    ).rejects.toMatchObject({
      body: { code: "INVALID_VERIFICATION_TOKEN" },
    });
  });

  it("should treat an already-verified user as a no-op", async () => {
    const result = await verifyAuth.api.verifyEmailTenant({ query: { token: tokenX } });
    expect(result.status).toBe(true);
    expect(result.user).toBeNull();
  });

  it("should reject an expired or malformed token", async () => {
    await expect(
      verifyAuth.api.verifyEmailTenant({ query: { token: "not-a-real-token" } }),
    ).rejects.toMatchObject({
      body: { code: "INVALID_TOKEN" },
    });
  });
});
