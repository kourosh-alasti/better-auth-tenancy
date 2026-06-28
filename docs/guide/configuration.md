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

Authorizes tenant and OAuth-config management requests (`create`, `update`, `delete` tenants and OAuth configs).

When provided, this **fully replaces** the default check (which requires an authenticated session). Return `false` to deny access.

Example — admin API key:

```ts
tenantAuth({
  canManageTenants: (ctx) => ctx.headers?.get("x-admin-key") === process.env.ADMIN_SECRET,
});
```

## `schema`

Pass a custom Better Auth plugin schema to rename models or fields. The plugin merges your overrides with its default schema via `mergeSchema`.

## Types

```ts
interface TenantAuthOptions {
  resolveTenantId?: (ctx: GenericEndpointContext) => Awaitable<string | null | undefined>;
  tenantHeader?: string;
  keepEmailGloballyUnique?: boolean;
  canManageTenants?: (ctx: GenericEndpointContext) => Awaitable<boolean>;
  schema?: BetterAuthPluginDBSchema;
}
```

See also: [Schema reference](/api/schema) and [Endpoints](/api/endpoints).
