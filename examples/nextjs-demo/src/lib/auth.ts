import { tenantAuth } from "@better-auth/tenancy";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";

import * as schema from "@/db/auth-schema";
import { tenant } from "@/db/auth-schema";

import { db } from "./db";

const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
  },
  ...(googleEnabled
    ? {
        socialProviders: {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          },
        },
      }
    : {}),
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      console.log(`[verify] ${user.email}: ${url}`);
    },
  },
  plugins: [
    tenantAuth({
      canManageTenants: (ctx) => ctx.headers?.get("x-admin-key") === process.env.ADMIN_SECRET,
      resolveTenantId: async (ctx) => {
        const slug = ctx.headers?.get("x-tenant-slug");
        if (!slug) return null;
        const row = await db.query.tenant.findFirst({
          where: eq(tenant.slug, slug),
          columns: { id: true },
        });
        return row?.id ?? null;
      },
    }),
  ],
});
