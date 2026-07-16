/**
 * Postgres-backed integration tests.
 *
 * Requires a local Postgres matching Better Auth's test helper defaults:
 *   postgres://user:password@localhost:5432/better_auth
 *
 * Skip locally unless TEST_POSTGRES=1. CI runs this job with a Postgres service.
 */
import { parseSetCookieHeader } from "better-auth/cookies";
import { getTestInstance } from "better-auth/test";
import { sql } from "kysely";
import { describe, expect, it } from "vite-plus/test";

import { tenantAuth } from "../src/index";
import { tenantAuthClient } from "../src/client";

const runPostgres = process.env.TEST_POSTGRES === "1";

type KyselyLike = {
  executeQuery?: (query: { sql: string; parameters: unknown[] }) => Promise<unknown>;
  destroy?: () => Promise<void>;
};

async function applyCompositeIndexes(
  auth: Awaited<ReturnType<typeof getTestInstance>>["auth"],
): Promise<void> {
  const database = auth.options.database as { db?: KyselyLike; type?: string } | undefined;
  const db = database?.db;
  if (!db) {
    throw new Error("Expected Better Auth postgres test helper to expose a Kysely db");
  }

  // Better Auth's default migrations keep camelCase column/table names.
  // These are the indexes apps must add manually (see docs/api/schema.md).
  const statements = [
    `CREATE UNIQUE INDEX IF NOT EXISTS user_email_platform_unique ON "user" (email) WHERE "tenantId" IS NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS user_email_tenant_unique ON "user" (email, "tenantId") WHERE "tenantId" IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS tenant_member_tenant_user_unique ON "tenantMember" ("tenantId", "userId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS tenant_oauth_tenant_provider_unique ON "tenantOauthConfig" ("tenantId", "providerId")`,
  ];

  for (const statement of statements) {
    await sql.raw(statement).execute(db as never);
  }
}

describe.runIf(runPostgres)("postgres integration", async () => {
  const { auth } = await getTestInstance(
    {
      emailAndPassword: { enabled: true },
      plugins: [
        tenantAuth({
          canManageTenants: (ctx) => ctx.headers?.get("x-admin") === "1",
        }),
      ],
    },
    {
      testWith: "postgres",
      clientOptions: { plugins: [tenantAuthClient()] },
      disableTestUser: true,
    },
  );

  const adminHeaders = new Headers({ "x-admin": "1" });

  await applyCompositeIndexes(auth);

  it("creates a tenant and owner membership transactionally", async () => {
    const owner = await auth.api.signUpEmail({
      body: {
        name: "PG Owner",
        email: "pg-owner@platform.com",
        password: "pg-owner-password",
      },
      returnHeaders: true,
    });
    const headers = new Headers();
    const cookies = parseSetCookieHeader(owner.headers.get("set-cookie") || "");
    for (const [name, { value }] of cookies.entries()) {
      headers.append("cookie", `${name}=${value}`);
    }

    const tenant = await auth.api.createTenant({
      body: { name: "PG Co", slug: "pg-co" },
      headers,
    });
    expect(tenant.ownerId).toBe(owner.response.user.id);

    const members = await auth.api.listTenantMembers({
      query: { tenantId: tenant.id },
      headers,
    });
    const list = Array.isArray(members) ? members : members.data;
    expect(list).toHaveLength(1);
    expect(list[0]!.role).toBe("owner");
  });

  it("enforces per-tenant email uniqueness at the database layer", async () => {
    const tenant = await auth.api.createTenant({
      body: { name: "Unique Co", slug: "unique-co" },
      headers: adminHeaders,
    });

    await auth.api.signUpEmailTenant({
      body: {
        tenantId: tenant.id,
        name: "First",
        email: "same@example.com",
        password: "password-1",
      },
    });

    await expect(
      auth.api.signUpEmailTenant({
        body: {
          tenantId: tenant.id,
          name: "Duplicate",
          email: "same@example.com",
          password: "password-2",
        },
      }),
    ).rejects.toMatchObject({
      body: { code: "USER_ALREADY_EXISTS" },
    });
  });

  it("allows the same email under different tenants", async () => {
    const tenantA = await auth.api.createTenant({
      body: { name: "Tenant A PG", slug: "tenant-a-pg" },
      headers: adminHeaders,
    });
    const tenantB = await auth.api.createTenant({
      body: { name: "Tenant B PG", slug: "tenant-b-pg" },
      headers: adminHeaders,
    });

    const userA = await auth.api.signUpEmailTenant({
      body: {
        tenantId: tenantA.id,
        name: "Shared Email A",
        email: "shared@example.com",
        password: "password-a",
      },
    });
    const userB = await auth.api.signUpEmailTenant({
      body: {
        tenantId: tenantB.id,
        name: "Shared Email B",
        email: "shared@example.com",
        password: "password-b",
      },
    });

    expect(userA.user.id).not.toBe(userB.user.id);
    expect((userA.user as typeof userA.user & { tenantId?: string }).tenantId).toBe(tenantA.id);
    expect((userB.user as typeof userB.user & { tenantId?: string }).tenantId).toBe(tenantB.id);
  });
});
