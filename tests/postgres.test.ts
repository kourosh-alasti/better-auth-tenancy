/**
 * Postgres + Drizzle integration tests.
 *
 * Uses the production-shaped schema (including composite/partial unique
 * indexes) instead of Better Auth's built-in Kysely migrator, which cannot
 * order the circular tenant ↔ user foreign keys.
 *
 * Requires:
 *   DATABASE_URL=postgres://user:password@localhost:5432/better_auth
 *   TEST_POSTGRES=1
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { parseSetCookieHeader } from "better-auth/cookies";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { tenantAuth } from "../src/index";
import * as schema from "./pg/schema";

const runPostgres = process.env.TEST_POSTGRES === "1";
const connectionString =
  process.env.DATABASE_URL ?? "postgres://user:password@localhost:5432/better_auth";

describe.runIf(runPostgres)("postgres integration", async () => {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  // Dedicated CI database — reset so indexes/tables match this schema.
  await client.unsafe(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`);

  const { apply } = await pushSchema(schema, db as never);
  await apply();

  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "better-auth-secret-that-is-long-enough-for-validation-test",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    plugins: [
      tenantAuth({
        canManageTenants: (ctx) => ctx.headers?.get("x-admin") === "1",
      }),
    ],
  });

  const adminHeaders = new Headers({ "x-admin": "1" });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

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
