# Tenant management

The plugin exposes CRUD endpoints for tenants.

## Authorization

Management access is resolved in this order:

1. **`canManageTenants` returns `true`** — global admin (e.g. operator API key). Can create and manage every tenant.
2. **Authenticated platform user** — a session whose `user.tenantId` is null. Can create tenants (and becomes their owner) and manage only tenants they own.
3. **Otherwise** — denied. Any authenticated session is no longer enough.

Tenant end-users (`user.tenantId` set) cannot create or manage tenants.

## Create a tenant

As a platform user (core Better Auth session on `app.com`):

```ts
const { data: tenant } = await authClient.$fetch("/tenant/create", {
  method: "POST",
  body: {
    name: "Acme Corp",
    slug: "acme",
    metadata: { plan: "pro" }, // optional, stored as JSON string
  },
});
// tenant.ownerId === current platform user id
```

Or via a global admin key:

```ts
await auth.api.createTenant({
  body: { name: "Acme Corp", slug: "acme" },
  headers: { "x-admin-key": process.env.ADMIN_SECRET },
});
// ownerId is null when no platform session is present
```

## Get a tenant

Look up by id or slug (public):

```ts
await authClient.$fetch("/tenant/get?slug=acme");
// or
await authClient.$fetch("/tenant/get?id=<tenant-id>");
```

## List tenants

- Global admin: all tenants
- Platform owner: only tenants where `ownerId` matches the session user

```ts
await authClient.$fetch("/tenant/list");
```

## Update a tenant

Requires ownership or global admin.

```ts
await authClient.$fetch("/tenant/update", {
  method: "POST",
  body: {
    id: "<tenant-id>",
    data: {
      name: "Acme Inc",
      slug: "acme-inc", // optional
      metadata: { plan: "enterprise" }, // optional
    },
  },
});
```

## Delete a tenant

Requires ownership or global admin. Cascades to related users, sessions, accounts, and OAuth configs (via foreign key references).

```ts
await authClient.$fetch("/tenant/delete", {
  method: "POST",
  body: { id: "<tenant-id>" },
});
```

## Tenant model

| Field       | Type     | Description                                        |
| ----------- | -------- | -------------------------------------------------- |
| `id`        | `string` | Unique identifier                                  |
| `name`      | `string` | Display name                                       |
| `slug`      | `string` | URL-friendly unique identifier                     |
| `ownerId`   | `string` | Platform user who owns the tenant (`null` if none) |
| `metadata`  | `string` | Optional JSON-serialized metadata                  |
| `createdAt` | `Date`   | Creation timestamp                                 |
| `updatedAt` | `Date`   | Last update timestamp                              |

See [Endpoints](/api/endpoints) for full request/response details.
