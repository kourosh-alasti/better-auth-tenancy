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
