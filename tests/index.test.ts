import { parseSetCookieHeader } from "better-auth/cookies";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vite-plus/test";

import { tenantAuth } from "../src/index";
import { tenantAuthClient } from "../src/client";
import * as tenantUtils from "../src/utils";

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

  describe("slug validation", () => {
    it("should reject invalid slug formats on create", async () => {
      for (const slug of ["Bad-Slug", "under_score", "-leading", "trailing-", "a", "sp ace"]) {
        await expect(
          auth.api.createTenant({
            body: { name: "Invalid", slug },
            headers: adminHeaders,
          }),
        ).rejects.toMatchObject({
          body: { code: "INVALID_SLUG" },
        });
      }
    });

    it("should reject reserved slugs", async () => {
      for (const slug of ["admin", "api", "www", "auth"]) {
        await expect(
          auth.api.createTenant({
            body: { name: "Reserved", slug },
            headers: adminHeaders,
          }),
        ).rejects.toMatchObject({
          body: { code: "SLUG_RESERVED" },
        });
      }
    });

    it("should reject invalid or reserved slugs on update", async () => {
      await expect(
        auth.api.updateTenant({
          body: { id: tenantA.id, data: { slug: "Bad Slug" } },
          headers: adminHeaders,
        }),
      ).rejects.toMatchObject({
        body: { code: "INVALID_SLUG" },
      });
      await expect(
        auth.api.updateTenant({
          body: { id: tenantA.id, data: { slug: "admin" } },
          headers: adminHeaders,
        }),
      ).rejects.toMatchObject({
        body: { code: "SLUG_RESERVED" },
      });
    });
  });

  describe("public tenant DTO", () => {
    const dtoOwnerHeaders = new Headers();
    let dtoTenant: { id: string };

    it("should hide ownerId and metadata from unauthorized callers", async () => {
      const signUp = await auth.api.signUpEmail({
        body: {
          name: "DTO Owner",
          email: "dto-owner@platform.com",
          password: "dto-owner-password",
        },
        returnHeaders: true,
      });
      const cookies = parseSetCookieHeader(signUp.headers.get("set-cookie") || "");
      for (const [name, { value }] of cookies.entries()) {
        dtoOwnerHeaders.append("cookie", `${name}=${value}`);
      }

      dtoTenant = await auth.api.createTenant({
        body: { name: "DTO Co", slug: "dto-co", metadata: { plan: "enterprise" } },
        headers: dtoOwnerHeaders,
      });

      const publicTenant = (await auth.api.getTenant({
        query: { id: dtoTenant.id },
      })) as Record<string, unknown>;
      expect(publicTenant.id).toBe(dtoTenant.id);
      expect(publicTenant.name).toBe("DTO Co");
      expect(publicTenant.slug).toBe("dto-co");
      expect(publicTenant.ownerId).toBeUndefined();
      expect(publicTenant.metadata).toBeUndefined();
    });

    it("should return the full record to a member of the tenant", async () => {
      const full = (await auth.api.getTenant({
        query: { id: dtoTenant.id },
        headers: dtoOwnerHeaders,
      })) as Record<string, unknown>;
      expect(full.ownerId).toBeDefined();
      expect(full.metadata).toBeDefined();
    });

    it("should return the full record to a global admin", async () => {
      const full = (await auth.api.getTenant({
        query: { id: dtoTenant.id },
        headers: adminHeaders,
      })) as Record<string, unknown>;
      expect(full.ownerId).toBeDefined();
      expect(full.metadata).toBeDefined();
    });

    it("should hide details from an unrelated platform user", async () => {
      const signUp = await auth.api.signUpEmail({
        body: {
          name: "DTO Stranger",
          email: "dto-stranger@platform.com",
          password: "dto-stranger-password",
        },
        returnHeaders: true,
      });
      const strangerHeaders = new Headers();
      const cookies = parseSetCookieHeader(signUp.headers.get("set-cookie") || "");
      for (const [name, { value }] of cookies.entries()) {
        strangerHeaders.append("cookie", `${name}=${value}`);
      }

      const publicTenant = (await auth.api.getTenant({
        query: { id: dtoTenant.id },
        headers: strangerHeaders,
      })) as Record<string, unknown>;
      expect(publicTenant.ownerId).toBeUndefined();
      expect(publicTenant.metadata).toBeUndefined();
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

      const tenant = await auth.api.getTenant({
        query: { id: rbacTenant.id },
        headers: ownerHeaders,
      });
      expect(tenant.ownerId).toBe(ownerUserId);

      const members = await auth.api.listTenantMembers({
        query: { tenantId: rbacTenant.id },
        headers: ownerHeaders,
      });
      expect(members.filter((m) => m.role === "owner")).toHaveLength(1);
      expect(members.some((m) => m.userId === ownerUserId && m.role === "owner")).toBe(true);
    });

    it("should prevent demoting the last owner", async () => {
      await expect(
        auth.api.updateTenantMember({
          body: { tenantId: rbacTenant.id, userId: ownerUserId, role: "admin" },
          headers: ownerHeaders,
        }),
      ).rejects.toMatchObject({
        body: { code: "CANNOT_REMOVE_LAST_OWNER" },
      });

      const tenant = await auth.api.getTenant({
        query: { id: rbacTenant.id },
        headers: ownerHeaders,
      });
      expect(tenant.ownerId).toBe(ownerUserId);
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

  describe("owner durability", () => {
    const ownerHeaders = new Headers();
    const coOwnerHeaders = new Headers();
    let ownerUserId = "";
    let coOwnerUserId = "";
    let durableTenant: { id: string; ownerId?: string | null };

    it("should set up a tenant with two owners", async () => {
      const owner = await auth.api.signUpEmail({
        body: {
          name: "Durable Owner",
          email: "durable-owner@platform.com",
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

      durableTenant = await auth.api.createTenant({
        body: { name: "Durable Co", slug: "durable-co" },
        headers: ownerHeaders,
      });
      expect(durableTenant.ownerId).toBe(ownerUserId);

      const coOwner = await auth.api.signUpEmail({
        body: {
          name: "Durable Co-Owner",
          email: "durable-coowner@platform.com",
          password: "password",
        },
        returnHeaders: true,
      });
      coOwnerUserId = coOwner.response.user.id;
      for (const [name, { value }] of parseSetCookieHeader(
        coOwner.headers.get("set-cookie") || "",
      ).entries()) {
        coOwnerHeaders.append("cookie", `${name}=${value}`);
      }

      await auth.api.addTenantMember({
        body: { tenantId: durableTenant.id, userId: coOwnerUserId, role: "owner" },
        headers: ownerHeaders,
      });

      const tenant = await auth.api.getTenant({
        query: { id: durableTenant.id },
        headers: ownerHeaders,
      });
      expect(tenant.ownerId).toBe(ownerUserId);
    });

    it("should reassign ownerId when the primary owner is demoted", async () => {
      await auth.api.updateTenantMember({
        body: { tenantId: durableTenant.id, userId: ownerUserId, role: "admin" },
        headers: ownerHeaders,
      });

      const tenant = await auth.api.getTenant({
        query: { id: durableTenant.id },
        headers: coOwnerHeaders,
      });
      expect(tenant.ownerId).toBe(coOwnerUserId);

      const members = await auth.api.listTenantMembers({
        query: { tenantId: durableTenant.id },
        headers: coOwnerHeaders,
      });
      expect(members.filter((m) => m.role === "owner")).toHaveLength(1);
      expect(members.some((m) => m.userId === coOwnerUserId && m.role === "owner")).toBe(true);
    });

    it("should reassign ownerId when an owner is removed", async () => {
      await auth.api.updateTenantMember({
        body: { tenantId: durableTenant.id, userId: ownerUserId, role: "owner" },
        headers: coOwnerHeaders,
      });

      const tenantBefore = await auth.api.getTenant({
        query: { id: durableTenant.id },
        headers: coOwnerHeaders,
      });
      expect(tenantBefore.ownerId).toBe(ownerUserId);

      await auth.api.removeTenantMember({
        body: { tenantId: durableTenant.id, userId: ownerUserId },
        headers: coOwnerHeaders,
      });

      const tenant = await auth.api.getTenant({
        query: { id: durableTenant.id },
        headers: coOwnerHeaders,
      });
      expect(tenant.ownerId).toBe(coOwnerUserId);
    });
  });

  describe("atomic tenant creation", () => {
    it("should delete the tenant when owner membership creation fails", async () => {
      const logger = { error: vi.fn() };
      const adapter = {
        create: vi.fn(async (args: { model: string; data: Record<string, unknown> }) => {
          if (args.model === "tenant") {
            return { id: "tenant-rollback-test", ...args.data };
          }
          if (args.model === "tenantMember") {
            throw new Error("simulated membership failure");
          }
          throw new Error(`unexpected model ${args.model}`);
        }),
        delete: vi.fn(async () => undefined),
      };
      const ctx = {
        context: { adapter, logger },
      } as Parameters<typeof tenantUtils.createTenantWithOwner>[0];

      await expect(
        tenantUtils.createTenantWithOwner(
          ctx,
          {
            name: "Rollback Co",
            slug: "rollback-co",
            ownerId: "user-1",
            metadata: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          "user-1",
        ),
      ).rejects.toThrow("simulated membership failure");

      expect(adapter.create).toHaveBeenCalledTimes(2);
      expect(adapter.delete).toHaveBeenCalledWith({
        model: "tenant",
        where: [{ field: "id", value: "tenant-rollback-test" }],
      });
      expect(logger.error).not.toHaveBeenCalled();
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

  describe("tenant sign-up policy", async () => {
    const adminHeaders = new Headers({ "x-admin": "1" });

    describe("invite-only sign-up", async () => {
      const { auth: inviteAuth } = await getTestInstance(
        {
          emailAndPassword: { enabled: true },
          plugins: [
            tenantAuth({
              canManageTenants: (ctx) => ctx.headers?.get("x-admin") === "1",
              requireInviteForTenantSignUp: true,
            }),
          ],
        },
        { clientOptions: { plugins: [tenantAuthClient()] } },
      );

      const inviteTenant = await inviteAuth.api.createTenant({
        body: { name: "Invite Tenant", slug: "invite-tenant" },
        headers: adminHeaders,
      });

      it("should block sign-up without an invite when invite is required", async () => {
        await expect(
          inviteAuth.api.signUpEmailTenant({
            body: {
              tenantId: inviteTenant.id,
              name: "No Invite",
              email: "no-invite@example.com",
              password: "password-1",
            },
          }),
        ).rejects.toMatchObject({
          body: { code: "INVITE_REQUIRED" },
        });
      });

      it("should allow sign-up with a valid invite and consume it", async () => {
        const invite = await inviteAuth.api.createTenantInvite({
          body: {
            tenantId: inviteTenant.id,
            email: "invited@example.com",
          },
          headers: adminHeaders,
        });

        const res = await inviteAuth.api.signUpEmailTenant({
          body: {
            tenantId: inviteTenant.id,
            name: "Invited User",
            email: "invited@example.com",
            password: "password-2",
            inviteToken: invite.token,
          },
        });
        expect(res.token).toBeDefined();
        expect((res.user as typeof res.user & { tenantId?: string }).tenantId).toBe(
          inviteTenant.id,
        );

        const invites = await inviteAuth.api.listTenantInvites({
          query: { tenantId: inviteTenant.id, includeConsumed: true },
          headers: adminHeaders,
        });
        const consumed = invites.find((item) => item.id === invite.id);
        expect(consumed?.consumedAt).toBeTruthy();
      });

      it("should reject reusing a consumed invite", async () => {
        const invite = await inviteAuth.api.createTenantInvite({
          body: {
            tenantId: inviteTenant.id,
            email: "single-use@example.com",
          },
          headers: adminHeaders,
        });

        await inviteAuth.api.signUpEmailTenant({
          body: {
            tenantId: inviteTenant.id,
            name: "First User",
            email: "single-use@example.com",
            password: "password-3",
            inviteToken: invite.token,
          },
        });

        await expect(
          inviteAuth.api.signUpEmailTenant({
            body: {
              tenantId: inviteTenant.id,
              name: "Second User",
              email: "single-use@example.com",
              password: "password-4",
              inviteToken: invite.token,
            },
          }),
        ).rejects.toMatchObject({
          body: { code: "INVITE_INVALID" },
        });
      });
    });

    describe("email domain allowlist", async () => {
      const { auth: domainAuth } = await getTestInstance({
        emailAndPassword: { enabled: true },
        plugins: [
          tenantAuth({
            canManageTenants: (ctx) => ctx.headers?.get("x-admin") === "1",
            allowedEmailDomains: ["allowed.example"],
          }),
        ],
      });

      const domainTenant = await domainAuth.api.createTenant({
        body: { name: "Domain Tenant", slug: "domain-tenant" },
        headers: adminHeaders,
      });

      it("should allow sign-up when the email domain is allowlisted", async () => {
        const res = await domainAuth.api.signUpEmailTenant({
          body: {
            tenantId: domainTenant.id,
            name: "Allowed User",
            email: "user@allowed.example",
            password: "password-5",
          },
        });
        expect(res.token).toBeDefined();
      });

      it("should reject sign-up when the email domain is not allowlisted", async () => {
        await expect(
          domainAuth.api.signUpEmailTenant({
            body: {
              tenantId: domainTenant.id,
              name: "Blocked User",
              email: "user@blocked.example",
              password: "password-6",
            },
          }),
        ).rejects.toMatchObject({
          body: { code: "EMAIL_DOMAIN_NOT_ALLOWED" },
        });
      });
    });

    describe("backward-compatible sign-up", async () => {
      const { auth: openAuth } = await getTestInstance({
        emailAndPassword: { enabled: true },
        plugins: [
          tenantAuth({
            canManageTenants: (ctx) => ctx.headers?.get("x-admin") === "1",
          }),
        ],
      });

      const openTenant = await openAuth.api.createTenant({
        body: { name: "Open Tenant", slug: "open-tenant" },
        headers: adminHeaders,
      });

      it("should allow open sign-up when no policy is configured", async () => {
        const res = await openAuth.api.signUpEmailTenant({
          body: {
            tenantId: openTenant.id,
            name: "Open User",
            email: "open-user@example.com",
            password: "password-7",
          },
        });
        expect(res.token).toBeDefined();
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

  describe("OAuth sign-up policy", async () => {
    const adminHeadersLocal = new Headers({ "x-admin": "1" });

    const runTenantOAuthCallback = async (
      oauthAuth: Awaited<ReturnType<typeof getTestInstance>>["auth"],
      oauthFetch: Awaited<ReturnType<typeof getTestInstance>>["customFetchImpl"],
      opts: {
        tenantId: string;
        inviteToken?: string;
        providerUser: { id: string; email: string; name: string };
      },
    ) => {
      const { headers: signInHeaders, response: signInRes } =
        await oauthAuth.api.signInSocialTenant({
          body: {
            tenantId: opts.tenantId,
            provider: "google",
            callbackURL: "/welcome",
            errorCallbackURL: "/error",
            disableRedirect: true,
            ...(opts.inviteToken ? { inviteToken: opts.inviteToken } : {}),
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
          id: opts.providerUser.id,
          email: opts.providerUser.email,
          name: opts.providerUser.name,
          emailVerified: true,
        },
        data: {},
      });
      return await oauthFetch(
        `http://localhost:3000/api/auth/tenant/callback/google?code=test-code&state=${encodeURIComponent(state)}`,
        {
          method: "GET",
          redirect: "manual",
          headers: { cookie: cookieHeader },
        },
      );
    };

    describe("invite-only OAuth registration", async () => {
      const { auth: inviteOAuthAuth, customFetchImpl: inviteOAuthFetch } = await getTestInstance(
        {
          emailAndPassword: { enabled: true },
          socialProviders: {
            google: {
              clientId: "global-client-id",
              clientSecret: "global-client-secret",
            },
          },
          plugins: [
            tenantAuth({
              canManageTenants: (ctx) => ctx.headers?.get("x-admin") === "1",
              requireInviteForTenantSignUp: true,
            }),
          ],
        },
        { clientOptions: { plugins: [tenantAuthClient()] } },
      );

      const inviteOAuthTenant = await inviteOAuthAuth.api.createTenant({
        body: { name: "Invite OAuth", slug: "invite-oauth" },
        headers: adminHeadersLocal,
      });
      await inviteOAuthAuth.api.registerTenantOAuthConfig({
        body: {
          tenantId: inviteOAuthTenant.id,
          providerId: "google",
          clientId: "invite-oauth-client",
          clientSecret: "invite-oauth-secret",
        },
        headers: adminHeadersLocal,
      });

      it("should reject first-time OAuth registration without an invite", async () => {
        const response = await runTenantOAuthCallback(inviteOAuthAuth, inviteOAuthFetch, {
          tenantId: inviteOAuthTenant.id,
          providerUser: {
            id: "google-no-invite",
            email: "oauth-no-invite@example.com",
            name: "No Invite",
          },
        });
        expect(response.status).toBe(302);
        const location = response.headers.get("location")!;
        expect(location).toContain("/error");
        expect(location).toContain("error=invite_required");
      });

      it("should allow first-time OAuth registration with a valid invite and consume it", async () => {
        const invite = await inviteOAuthAuth.api.createTenantInvite({
          body: {
            tenantId: inviteOAuthTenant.id,
            email: "oauth-invited@example.com",
          },
          headers: adminHeadersLocal,
        });

        const response = await runTenantOAuthCallback(inviteOAuthAuth, inviteOAuthFetch, {
          tenantId: inviteOAuthTenant.id,
          inviteToken: invite.token,
          providerUser: {
            id: "google-invited",
            email: "oauth-invited@example.com",
            name: "Invited OAuth",
          },
        });
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe("/welcome");

        const invites = await inviteOAuthAuth.api.listTenantInvites({
          query: { tenantId: inviteOAuthTenant.id, includeConsumed: true },
          headers: adminHeadersLocal,
        });
        expect(invites.find((item) => item.id === invite.id)?.consumedAt).toBeTruthy();
      });

      it("should allow subsequent OAuth sign-in without an invite", async () => {
        const response = await runTenantOAuthCallback(inviteOAuthAuth, inviteOAuthFetch, {
          tenantId: inviteOAuthTenant.id,
          providerUser: {
            id: "google-invited",
            email: "oauth-invited@example.com",
            name: "Invited OAuth",
          },
        });
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe("/welcome");
      });
    });

    describe("domain allowlist OAuth registration", async () => {
      const { auth: domainOAuthAuth, customFetchImpl: domainOAuthFetch } = await getTestInstance(
        {
          emailAndPassword: { enabled: true },
          socialProviders: {
            google: {
              clientId: "global-client-id",
              clientSecret: "global-client-secret",
            },
          },
          plugins: [
            tenantAuth({
              canManageTenants: (ctx) => ctx.headers?.get("x-admin") === "1",
              allowedEmailDomains: ["allowed.example"],
            }),
          ],
        },
        { clientOptions: { plugins: [tenantAuthClient()] } },
      );

      const domainOAuthTenant = await domainOAuthAuth.api.createTenant({
        body: { name: "Domain OAuth", slug: "domain-oauth" },
        headers: adminHeadersLocal,
      });
      await domainOAuthAuth.api.registerTenantOAuthConfig({
        body: {
          tenantId: domainOAuthTenant.id,
          providerId: "google",
          clientId: "domain-oauth-client",
          clientSecret: "domain-oauth-secret",
        },
        headers: adminHeadersLocal,
      });

      it("should reject OAuth registration when the email domain is not allowlisted", async () => {
        const response = await runTenantOAuthCallback(domainOAuthAuth, domainOAuthFetch, {
          tenantId: domainOAuthTenant.id,
          providerUser: {
            id: "google-blocked-domain",
            email: "user@blocked.example",
            name: "Blocked Domain",
          },
        });
        expect(response.status).toBe(302);
        const location = response.headers.get("location")!;
        expect(location).toContain("/error");
        expect(location).toContain("error=email_domain_not_allowed");
      });

      it("should allow OAuth registration when the email domain is allowlisted", async () => {
        const response = await runTenantOAuthCallback(domainOAuthAuth, domainOAuthFetch, {
          tenantId: domainOAuthTenant.id,
          providerUser: {
            id: "google-allowed-domain",
            email: "user@allowed.example",
            name: "Allowed Domain",
          },
        });
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe("/welcome");
      });
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

  describe("tenant metadata updates", () => {
    it("should set, clear, and omit metadata on update", async () => {
      const tenant = await auth.api.createTenant({
        body: { name: "Meta Co", slug: "meta-co", metadata: { plan: "pro" } },
        headers: adminHeaders,
      });
      expect(tenant.metadata).toBe(JSON.stringify({ plan: "pro" }));

      const updated = await auth.api.updateTenant({
        body: { id: tenant.id, data: { metadata: { plan: "enterprise", seats: 10 } } },
        headers: adminHeaders,
      });
      expect(updated.metadata).toBe(JSON.stringify({ plan: "enterprise", seats: 10 }));

      const cleared = await auth.api.updateTenant({
        body: { id: tenant.id, data: { metadata: null } },
        headers: adminHeaders,
      });
      expect(cleared.metadata).toBeNull();

      const renamed = await auth.api.updateTenant({
        body: { id: tenant.id, data: { name: "Meta Co Renamed" } },
        headers: adminHeaders,
      });
      expect(renamed.name).toBe("Meta Co Renamed");
      expect(renamed.metadata).toBeNull();
    });
  });

  describe("list pagination", () => {
    it("should return a plain array without pagination params", async () => {
      const tenants = await auth.api.listTenants({ headers: adminHeaders });
      expect(Array.isArray(tenants)).toBe(true);
      expect("data" in (tenants as object)).toBe(false);
    });

    it("should paginate listTenants", async () => {
      const page = (await auth.api.listTenants({
        query: { limit: 1, offset: 0 },
        headers: adminHeaders,
      })) as { data: { id: string }[]; total: number; nextOffset?: number };
      expect(page.data).toHaveLength(1);
      expect(page.total).toBeGreaterThanOrEqual(2);
      expect(page.nextOffset).toBe(1);
    });

    it("should paginate listTenantMembers", async () => {
      const ownerSignUp = await auth.api.signUpEmail({
        body: {
          name: "Pagination Owner",
          email: "pagination-owner@platform.com",
          password: "password",
        },
        returnHeaders: true,
      });
      const ownerHeaders = new Headers();
      for (const [name, { value }] of parseSetCookieHeader(
        ownerSignUp.headers.get("set-cookie") || "",
      ).entries()) {
        ownerHeaders.append("cookie", `${name}=${value}`);
      }
      const tenant = await auth.api.createTenant({
        body: { name: "Pagination Co", slug: "pagination-co" },
        headers: ownerHeaders,
      });
      const extra = await auth.api.signUpEmail({
        body: {
          name: "Pagination Extra",
          email: "pagination-extra@platform.com",
          password: "password",
        },
      });
      await auth.api.addTenantMember({
        body: { tenantId: tenant.id, userId: extra.user.id, role: "member" },
        headers: ownerHeaders,
      });

      const page = (await auth.api.listTenantMembers({
        query: { tenantId: tenant.id, limit: 1, offset: 0 },
        headers: ownerHeaders,
      })) as { data: unknown[]; total: number; nextOffset?: number };
      expect(page.data).toHaveLength(1);
      expect(page.total).toBe(2);
      expect(page.nextOffset).toBe(1);
    });
  });

  describe("platform user resolution by email", () => {
    it("should reject ambiguous platform users with the same email", async () => {
      const ctx = await auth.$context;
      const email = "ambiguous@platform.com";
      await ctx.adapter.create({
        model: "user",
        data: {
          id: "ambiguous-user-1",
          name: "Ambiguous One",
          email,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          tenantId: null,
        },
      });
      await ctx.adapter.create({
        model: "user",
        data: {
          id: "ambiguous-user-2",
          name: "Ambiguous Two",
          email,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          tenantId: null,
        },
      });

      await expect(
        auth.api.addTenantMember({
          body: { tenantId: tenantA.id, email, role: "member" },
          headers: adminHeaders,
        }),
      ).rejects.toMatchObject({
        body: { code: "PLATFORM_USER_AMBIGUOUS" },
      });
    });
  });

  describe("OAuth credential decryption", async () => {
    const { auth: strictAuth } = await getTestInstance(
      {
        emailAndPassword: { enabled: true },
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
      { clientOptions: { plugins: [tenantAuthClient()] } },
    );

    const { auth: legacyAuth } = await getTestInstance(
      {
        emailAndPassword: { enabled: true },
        socialProviders: {
          google: {
            clientId: "global-client-id",
            clientSecret: "global-client-secret",
          },
        },
        plugins: [
          tenantAuth({
            canManageTenants: (ctx) => ctx.headers?.get("x-admin") === "1",
            allowLegacyPlaintextCredentials: true,
          }),
        ],
      },
      { clientOptions: { plugins: [tenantAuthClient()] } },
    );

    const adminHeadersLocal = new Headers({ "x-admin": "1" });
    let decryptTenant: { id: string };

    it("should seed a tenant with legacy plaintext OAuth credentials", async () => {
      decryptTenant = await strictAuth.api.createTenant({
        body: { name: "Decrypt Co", slug: "decrypt-co" },
        headers: adminHeadersLocal,
      });
      const ctx = await strictAuth.$context;
      await ctx.adapter.create({
        model: "tenantOauthConfig",
        data: {
          id: "legacy-oauth-config",
          tenantId: decryptTenant.id,
          providerId: "google",
          clientId: "legacy-plaintext-client-id",
          clientSecret: "legacy-plaintext-client-secret",
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    });

    it("should fail to list OAuth configs when decryption fails", async () => {
      await expect(
        strictAuth.api.listTenantOAuthConfigs({
          query: { tenantId: decryptTenant.id },
          headers: adminHeadersLocal,
        }),
      ).rejects.toMatchObject({
        body: { code: "OAUTH_CREDENTIAL_DECRYPT_FAILED" },
      });
    });

    it("should fail social sign-in when decryption fails", async () => {
      await expect(
        strictAuth.api.signInSocialTenant({
          body: {
            tenantId: decryptTenant.id,
            provider: "google",
            callbackURL: "/dashboard",
            disableRedirect: true,
          },
        }),
      ).rejects.toMatchObject({
        body: { code: "OAUTH_CREDENTIAL_DECRYPT_FAILED" },
      });
    });

    it("should allow legacy plaintext credentials when migration mode is enabled", async () => {
      const legacyTenant = await legacyAuth.api.createTenant({
        body: { name: "Legacy Decrypt Co", slug: "legacy-decrypt-co" },
        headers: adminHeadersLocal,
      });
      const legacyCtx = await legacyAuth.$context;
      await legacyCtx.adapter.create({
        model: "tenantOauthConfig",
        data: {
          id: "legacy-oauth-config-2",
          tenantId: legacyTenant.id,
          providerId: "google",
          clientId: "legacy-plaintext-client-id",
          clientSecret: "legacy-plaintext-client-secret",
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const configs = await legacyAuth.api.listTenantOAuthConfigs({
        query: { tenantId: legacyTenant.id },
        headers: adminHeadersLocal,
      });
      expect(configs[0]!.clientId).toBe("legacy-plaintext-client-id");

      const res = await legacyAuth.api.signInSocialTenant({
        body: {
          tenantId: legacyTenant.id,
          provider: "google",
          callbackURL: "/dashboard",
          disableRedirect: true,
        },
      });
      expect(res.url).toBeDefined();
      const url = new URL(res.url!);
      expect(url.searchParams.get("client_id")).toBe("legacy-plaintext-client-id");
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
