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
