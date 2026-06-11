# Next.js Tenancy Demo

A minimal Next.js app demonstrating the full feature set of [`@better-auth/tenancy`](../../).

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for PostgreSQL)

## Quick start

From the **repository root**:

```bash
# 1. Install dependencies
pnpm install

# 2. Build the tenancy plugin
pnpm run build

# 3. Configure environment
cp examples/nextjs-demo/.env.example examples/nextjs-demo/.env

# 4. Start PostgreSQL (port 5433 to avoid conflicts with local Postgres)
cd examples/nextjs-demo && docker compose up -d

# 5. Generate auth schema and push to database
pnpm auth:schema
export $(grep -v '^#' .env | xargs) && pnpm exec drizzle-kit push

# 6. Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

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

Uses server actions with `x-admin-key: ADMIN_SECRET`:

| Action        | Endpoint              |
| ------------- | --------------------- |
| Create tenant | `POST /tenant/create` |
| List tenants  | `GET /tenant/list`    |
| Update tenant | `POST /tenant/update` |
| Delete tenant | `POST /tenant/delete` |

### Per-tenant OAuth (`/admin/tenants/[id]/oauth`)

| Action                    | Endpoint                             |
| ------------------------- | ------------------------------------ |
| Register / upsert config  | `POST /tenant/oauth-config/register` |
| List configs (no secrets) | `GET /tenant/oauth-config/list`      |
| Delete config             | `POST /tenant/oauth-config/delete`   |

### Tenant portal (`/t/[slug]`)

| Page      | Endpoint                     |
| --------- | ---------------------------- |
| Landing   | `GET /tenant/get?slug=...`   |
| Sign up   | `POST /tenant/sign-up/email` |
| Sign in   | `POST /tenant/sign-in/email` |
| Dashboard | Shows `session.tenantId`     |

**Multi-tenant email demo:** Create `tenant-a` and `tenant-b`, sign up `shared@demo.com` on each with different passwords. Sign-in only works with the matching tenant password.

**`x-tenant-slug` header:** On sign-in, enable the checkbox to resolve tenant via `resolveTenantId` without passing `tenantId` in the body.

### OAuth sign-in

1. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `NEXT_PUBLIC_GOOGLE_ENABLED=true`
2. Register redirect URI in Google Cloud Console:
   ```
   http://localhost:3000/api/auth/tenant/callback/google
   ```
3. Optionally register per-tenant OAuth credentials in admin (overrides global config)
4. Click "Sign in with Google" on `/t/[slug]/sign-in`
5. Callback handled at `GET /tenant/callback/google`, redirects to `/welcome`

Tenants **without** per-tenant OAuth config fall back to global `GOOGLE_CLIENT_*` env vars.

## Scripts

| Script             | Description                                |
| ------------------ | ------------------------------------------ |
| `pnpm dev`         | Start Next.js dev server                   |
| `pnpm docker:up`   | Start PostgreSQL container                 |
| `pnpm docker:down` | Stop PostgreSQL container                  |
| `pnpm auth:schema` | Regenerate Drizzle schema from auth config |
| `pnpm db:push`     | Push schema to database                    |

## Project structure

```
src/
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
