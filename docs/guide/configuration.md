# Configuration

`tenantAuth` accepts an optional options object:

```ts
tenantAuth({
  resolveTenantId: async (ctx) => {
    /* ... */
  },
  tenantHeader: "x-tenant-id",
  keepEmailGloballyUnique: false,
  canManageTenants: async (ctx) => {
    /* ... */
  },
  isPlatformRequest: async (ctx) => {
    /* ... */
  },
  enforceSessionTenant: true,
  reservedSlugs: ["my-app-route"],
  exposeTenantDetailsPublicly: false,
  schema: {
    /* custom model/field names */
  },
});
```

## `resolveTenantId`

Custom resolver for the tenant id. Called **before** the default resolution. Return a falsy value to fall through.

Default resolution order:

1. `resolveTenantId` callback (if provided and returns a value)
2. `tenantId` in the request body
3. `tenantId` in the query string
4. Tenant header (default: `x-tenant-id`)

Example — resolve tenant from a slug header:

```ts
tenantAuth({
  resolveTenantId: async (ctx) => {
    const slug = ctx.headers?.get("x-tenant-slug");
    if (!slug) return null;

    const tenant = await db.query.tenant.findFirst({
      where: eq(tenant.slug, slug),
      columns: { id: true },
    });
    return tenant?.id ?? null;
  },
});
```

Clients can then sign in without passing `tenantId` in the body when the header is set.

## `tenantHeader`

Header name used when `tenantId` is not in the body or query.

Default: `"x-tenant-id"`

## `keepEmailGloballyUnique`

When `false` (default), the plugin drops the global unique constraint on `user.email`. The same email can sign up under different tenants as separate users. Per-tenant uniqueness is enforced by the plugin's endpoints.

When `true`, emails remain globally unique — one email maps to one user across all tenants.

## `canManageTenants`

Global admin bypass for tenant and OAuth-config management.

When this returns `true`, the caller can manage every tenant. When it returns `false` or is omitted, access falls through to **membership**: an authenticated platform user (`user.tenantId` null) may create tenants (becoming `owner`) and manage tenants according to their role (`owner` / `admin` / `member`).

Tenant end-users and unauthenticated callers are denied. There is no “any session is admin” default.

Example — admin API key:

```ts
tenantAuth({
  canManageTenants: (ctx) => ctx.headers?.get("x-admin-key") === process.env.ADMIN_SECRET,
});
```

Platform users create tenants through a normal Better Auth session (no admin key required):

```ts
// Signed in on app.com via core sign-in
await auth.api.createTenant({
  body: { name: "Acme", slug: "acme" },
  headers, // session cookie
});
// → tenant.ownerId === session.user.id + tenantMember role owner
```

See [Tenant management](/guide/tenant-management) for the role permission matrix.

## `enforceSessionTenant` and `isPlatformRequest`

The plugin binds sessions to the tenant (or platform) host they belong to, so a cookie issued on one tenant host (or the platform host) can't be replayed against another. On every request that carries a session, it checks:

1. **A tenant resolves for the request** (via `resolveTenantId`'s resolution order — body/query `tenantId`, or the tenant header) → the session's tenant id (`session.session.tenantId`, falling back to `session.user.tenantId`) must equal it. Mismatch → `FORBIDDEN` / `SESSION_TENANT_MISMATCH`.
2. **No tenant resolves, but `isPlatformRequest(ctx)` returns `true`** → the session must not carry a tenant id. A tenant end-user's session can't be used on the platform host. Mismatch → `FORBIDDEN` / `SESSION_TENANT_MISMATCH`.
3. **Neither can be determined** → nothing is enforced (backward compatible).

This runs on `/get-session` and the tenant end-user auth surface (`/tenant/sign-up/email`, `/tenant/sign-in/email`, `/tenant/sign-in/social`, `/tenant/callback/*`). Tenant **management** endpoints (`/tenant/create`, `/tenant/update`, `/tenant/delete`, `/tenant/member/*`, `/tenant/oauth-config/*`) are intentionally excluded — they take a _target_ `tenantId` for a platform user/operator to manage, which is unrelated to the caller's own tenant context and is already authorized via `canManageTenants` / membership (see [Tenant management](/guide/tenant-management)).

```ts
tenantAuth({
  // e.g. compare against your platform domain
  isPlatformRequest: (ctx) => {
    const host = ctx.headers?.get("host");
    return host === "app.com";
  },
});
```

Set `enforceSessionTenant: false` to disable this check entirely (e.g. while migrating).

## `reservedSlugs`

Tenant slugs are always validated against DNS-label rules: 2–63 characters, lowercase letters / digits / hyphens, no leading or trailing hyphen (`INVALID_SLUG` otherwise). This keeps slugs safe to use as subdomains (`shop.app.com`) or path segments (`/t/shop`).

A built-in reserved list (`admin`, `api`, `app`, `auth`, `www`, `mail`, `dashboard`, `login`, `signup`, ...) blocks slugs that would collide with common routes and subdomains (`SLUG_RESERVED`). Use `reservedSlugs` to extend it with app-specific values:

```ts
tenantAuth({
  reservedSlugs: ["pricing", "careers", "cdn"],
});
```

## `exposeTenantDetailsPublicly`

`GET /tenant/get` is a public endpoint (tenant login pages need it to resolve a slug before any session exists). By default, unauthorized callers receive only the safe subset — `id`, `name`, `slug`, `createdAt` — while `ownerId` and `metadata` are reserved for tenant members and global admins.

Set this to `true` only if your tenant `metadata` contains nothing sensitive and you want it available publicly (e.g. for theming a login page).

## `requireInviteForTenantSignUp`

When `true`, **new** tenant end-user registration requires a valid invite token matching the email:

- Email: pass `inviteToken` on `POST /tenant/sign-up/email`
- Social/OAuth: pass `inviteToken` on `POST /tenant/sign-in/social` (carried through OAuth state and enforced at callback when creating a new user)

Existing users may still sign in without an invite. Invites are created by tenant admins/owners via `POST /tenant/invite/create` and are single-use.

Default: `false` (open sign-up when no other policy applies).

## `allowedEmailDomains`

Restrict **new** tenant end-user registration (email and first-time social/OAuth) to specific email domains. Ignored when `requireInviteForTenantSignUp` is `true`.

Pass a static list or a per-tenant resolver:

```ts
tenantAuth({
  allowedEmailDomains: ["acme.com", "acme.co.uk"],
});

// or per-tenant:
tenantAuth({
  allowedEmailDomains: async (tenantId, ctx) => {
    const tenant = await db.query.tenant.findFirst({ where: eq(tenant.id, tenantId) });
    return tenant?.metadata?.allowedDomains ?? [];
  },
});
```

When omitted and invite-only sign-up is disabled, sign-up remains open (backward compatible).

## `allowLegacyPlaintextCredentials`

When `false` (default), OAuth credentials that cannot be decrypted raise `OAUTH_CREDENTIAL_DECRYPT_FAILED` instead of being treated as plaintext. Set to `true` only while migrating rows created before credential encryption was introduced.

## `schema`

Pass a custom Better Auth plugin schema to rename models or fields. The plugin merges your overrides with its default schema via `mergeSchema`.

## Types

```ts
interface TenantAuthOptions {
  resolveTenantId?: (ctx: GenericEndpointContext) => Awaitable<string | null | undefined>;
  tenantHeader?: string;
  keepEmailGloballyUnique?: boolean;
  canManageTenants?: (ctx: GenericEndpointContext) => Awaitable<boolean>;
  isPlatformRequest?: (ctx: GenericEndpointContext) => Awaitable<boolean>;
  enforceSessionTenant?: boolean; // default: true
  reservedSlugs?: string[];
  exposeTenantDetailsPublicly?: boolean; // default: false
  requireInviteForTenantSignUp?: boolean; // default: false
  allowedEmailDomains?: string[] | ((tenantId: string, ctx) => Awaitable<string[]>);
  allowLegacyPlaintextCredentials?: boolean; // default: false
  schema?: BetterAuthPluginDBSchema;
}
```

See also: [Schema reference](/api/schema) and [Endpoints](/api/endpoints).
