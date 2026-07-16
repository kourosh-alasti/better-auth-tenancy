# better-auth-tenancy

Multi-tenant authentication plugin for [Better Auth](https://www.better-auth.com/).

Add tenant-scoped users, per-tenant OAuth, and management APIs to your Better Auth setup.

## Features

- **Tenant-scoped users** — the same email can exist under different tenants as separate users
- **Per-tenant OAuth** — store OAuth client credentials per tenant, with fallback to global providers
- **Management APIs** — create, update, list, and delete tenants and OAuth configs
- **Better Auth native** — extends schema, endpoints, and the client plugin alongside Better Auth adapters and sessions

## Requirements

- Node.js 20+
- [Better Auth](https://www.better-auth.com/) `^1.6.16`
- A supported database adapter (Drizzle, Prisma, etc.)

## Installation

```bash
pnpm add better-auth-tenancy better-auth
```

Peer dependencies (`@better-auth/core`, `better-call`) are typically installed automatically with `better-auth`.

## Usage

### Server

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

### Client

```ts
import { tenantAuthClient } from "better-auth-tenancy/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [tenantAuthClient()],
});
```

### Database schema

The plugin adds:

- `tenant` — tenant records
- `tenantOauthConfig` — per-tenant OAuth credentials
- `tenantId` on `user`, `session`, `account`, and `verification`

Generate and apply the schema with the Better Auth CLI:

```bash
npx @better-auth/cli generate
# then push or migrate with your ORM
```

By default, the global unique constraint on `user.email` is removed so the same address can exist under different tenants. Set `keepEmailGloballyUnique: true` on the plugin if you want one email to map to a single tenant globally.

### Quick example

```ts
// Platform user signs in on app.com, then creates a tenant they own
await auth.api.createTenant({
  body: { name: "Acme", slug: "acme" },
  headers, // platform session cookie
});

// Sign up under that tenant (tenant host /tenant/* routes)
await authClient.signUpEmailTenant({
  tenantId: tenant.id,
  email: "user@example.com",
  password: "secure-password",
  name: "Jane Doe",
});
```

## Documentation

Full guides and API reference live in the repo under [`docs/`](./docs/). A complete Next.js example with PostgreSQL and Drizzle is in [`examples/nextjs-demo/`](./examples/nextjs-demo/).

## License

MIT
