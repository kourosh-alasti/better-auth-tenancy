# Next.js demo

This repository includes a full Next.js demo at `examples/nextjs-demo` that demonstrates tenant management, email auth, per-tenant OAuth, and custom tenant resolution.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for PostgreSQL)

## Quick start

From the repository root:

```bash
# Install dependencies
pnpm install

# Build the tenancy plugin
pnpm run build

# Configure environment
cp examples/nextjs-demo/.env.example examples/nextjs-demo/.env

# Start PostgreSQL (port 5433)
cd examples/nextjs-demo && docker compose up -d

# Generate auth schema and push to database
pnpm auth:schema
export $(grep -v '^#' .env | xargs) && pnpm exec drizzle-kit push

# Start the dev server
pnpm dev
```

Open `http://localhost:3000` in your browser.

## Environment variables

| Variable                                    | Description                                             |
| ------------------------------------------- | ------------------------------------------------------- |
| `DATABASE_URL`                              | PostgreSQL connection string (default uses port `5433`) |
| `BETTER_AUTH_SECRET`                        | Secret for encryption and sessions                      |
| `BETTER_AUTH_URL`                           | Server base URL (`http://localhost:3000`)               |
| `NEXT_PUBLIC_APP_URL`                       | Client base URL                                         |
| `ADMIN_SECRET`                              | Sent as `x-admin-key` for tenant management             |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional global OAuth fallback                          |
| `NEXT_PUBLIC_GOOGLE_ENABLED`                | Set `true` to show Google sign-in button                |

## Feature walkthrough

### Admin (`/admin`)

Server actions use `x-admin-key: ADMIN_SECRET` for tenant CRUD and OAuth config management.

### Per-tenant OAuth (`/admin/tenants/[id]/oauth`)

Register, list, and delete OAuth credentials per tenant. Secrets are encrypted at rest.

### Tenant portal (`/t/[slug]`)

Each tenant gets a landing page, sign-up, sign-in, and dashboard showing `session.tenantId`.

**Multi-tenant email demo:** Create `tenant-a` and `tenant-b`, sign up `shared@demo.com` on each with different passwords. Sign-in only works with the matching tenant password.

**`x-tenant-slug` header:** On sign-in, enable the checkbox to resolve tenant via `resolveTenantId` without passing `tenantId` in the body.

### OAuth sign-in

1. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `NEXT_PUBLIC_GOOGLE_ENABLED=true`
2. Register redirect URI: `http://localhost:3000/api/auth/tenant/callback/google`
3. Optionally register per-tenant OAuth credentials in admin
4. Click "Sign in with Google" on `/t/[slug]/sign-in`

Tenants without per-tenant OAuth config fall back to global `GOOGLE_CLIENT_*` env vars.

## Key files

```
examples/nextjs-demo/src/
├── app/
│   ├── admin/           # Tenant + OAuth management
│   ├── api/auth/        # Better Auth handler
│   ├── t/[slug]/        # Tenant-scoped auth UI
│   └── welcome/         # OAuth callback landing
├── db/auth-schema.ts    # Generated Drizzle schema
└── lib/
    ├── auth.ts          # betterAuth + tenantAuth plugin
    ├── auth-client.ts   # Client with tenantAuthClient
    └── db.ts            # Drizzle + Postgres
```

## Auth configuration highlight

The demo uses custom management authorization and slug-based tenant resolution:

```ts
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
});
```

See the source in [`examples/nextjs-demo/src/lib/auth.ts`](https://github.com/kourosh-alasti/better-auth-tenancy/blob/main/examples/nextjs-demo/src/lib/auth.ts).
