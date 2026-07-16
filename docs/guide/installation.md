# Installation

## Requirements

- Node.js 20+
- [Better Auth](https://www.better-auth.com/) `^1.6.16`
- A supported database adapter (Drizzle, Prisma, etc.)

## Install the package

```bash
pnpm add better-auth-tenancy better-auth
```

Peer dependencies:

- `@better-auth/core`
- `better-call`

These are typically installed automatically with `better-auth`.

## Server plugin

Import `tenantAuth` and add it to your Better Auth config:

```ts
import { tenantAuth } from "better-auth-tenancy";
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  database: /* your adapter */,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
  plugins: [tenantAuth()],
});
```

## Client plugin

Import `tenantAuthClient` from the `/client` export:

```ts
import { tenantAuthClient } from "better-auth-tenancy/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [tenantAuthClient()],
});
```

The client plugin registers path methods and session listeners for tenant sign-in and sign-up endpoints.

## Database schema

The plugin extends your Better Auth schema with:

- `tenant` — tenant records (includes `ownerId`)
- `tenantMember` — platform-user roles on a tenant
- `tenantOauthConfig` — per-tenant OAuth credentials
- `tenantId` on `user`, `session`, `account`, and `verification`

Generate and apply the schema with the Better Auth CLI for your adapter. For example, with Drizzle:

```bash
npx @better-auth/cli generate
# then push or migrate with your ORM
```

By default the plugin removes the global unique constraint on `user.email` so the same address can exist under different tenants. **Add composite / partial unique indexes yourself** (Better Auth cannot emit them):

- Platform: unique `email` where `tenant_id IS NULL`
- Tenant users: unique `(email, tenant_id)` where `tenant_id IS NOT NULL`
- OAuth configs: unique `(tenant_id, provider_id)`
- Members: unique `(tenant_id, user_id)`

See [Schema](/api/schema) for SQL examples. Set `keepEmailGloballyUnique: true` if you want one email to map to a single user globally.

## Verify the setup

1. Start your auth server
2. Create a tenant via `POST /tenant/create`
3. Sign up with `POST /tenant/sign-up/email` passing `tenantId`
4. Confirm the session includes `tenantId`

See the [Next.js demo](/examples/nextjs) for a complete setup with PostgreSQL and Drizzle.
