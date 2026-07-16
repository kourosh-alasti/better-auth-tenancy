# Getting started

`better-auth-tenancy` is a [Better Auth](https://www.better-auth.com/) plugin that adds multi-tenant authentication to your app.

## What it provides

- A **`tenant` table** (with `ownerId`) and CRUD endpoints for tenant management
- **`tenantMember`** roles (`owner` / `admin` / `member`) for platform collaborators
- **`tenantInvite`** for invite-only tenant email sign-up
- A **`tenantId` column** on `user`, `session`, `account`, and `verification`
- **Platform vs tenant auth** — core routes for platform users on `app.com`; `/tenant/*` for tenant end-users
- **Tenant-scoped sign-up and sign-in** so the same email can exist under different tenants
- **`GET /tenant/verify-email`** for tenant-scoped email verification (not interchangeable with core `/verify-email`)
- **Sign-up policies** — optional invite-only sign-up and email-domain allowlists
- **Per-tenant OAuth configuration** stored in the database, with fallback to global social providers

## Minimal setup

Add the plugin on the server and client:

```ts
// auth.ts
import { tenantAuth } from "better-auth-tenancy";
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  // ...database, secret, etc.
  plugins: [tenantAuth()],
});
```

```ts
// auth-client.ts
import { tenantAuthClient } from "better-auth-tenancy/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [tenantAuthClient()],
});
```

Run the Better Auth CLI to generate or migrate your schema, then create a tenant and sign up a user:

```ts
// Create a tenant as a signed-in platform user (becomes owner)
await auth.api.createTenant({
  body: { name: "Acme", slug: "acme" },
  headers, // platform session
});

// Sign up under that tenant
await authClient.signUpEmailTenant({
  tenantId: tenant.id,
  email: "user@example.com",
  password: "secure-password",
  name: "Jane Doe",
});
```

## Next steps

- [Installation](/guide/installation) — install the package and wire up your database
- [Configuration](/guide/configuration) — customize tenant resolution and access control
- [Next.js demo](/examples/nextjs) — full working example in this repository
