# Tenant management

The plugin exposes CRUD endpoints for tenants. All management endpoints require authorization via `canManageTenants` or an authenticated session (see [Configuration](/guide/configuration)).

## Create a tenant

```ts
const { data: tenant } = await authClient.$fetch("/tenant/create", {
  method: "POST",
  body: {
    name: "Acme Corp",
    slug: "acme",
    metadata: { plan: "pro" }, // optional, stored as JSON string
  },
});
```

Or via the server API:

```ts
await auth.api.createTenant({
  body: { name: "Acme Corp", slug: "acme" },
  headers: { "x-admin-key": process.env.ADMIN_SECRET },
});
```

## Get a tenant

Look up by id or slug:

```ts
await authClient.$fetch("/tenant/get?slug=acme");
// or
await authClient.$fetch("/tenant/get?id=<tenant-id>");
```

## List tenants

```ts
await authClient.$fetch("/tenant/list");
```

## Update a tenant

```ts
await authClient.$fetch("/tenant/update", {
  method: "POST",
  body: {
    tenantId: "<tenant-id>",
    name: "Acme Inc",
    slug: "acme-inc", // optional
    metadata: { plan: "enterprise" }, // optional
  },
});
```

## Delete a tenant

Deleting a tenant cascades to related users, sessions, accounts, and OAuth configs (via foreign key references).

```ts
await authClient.$fetch("/tenant/delete", {
  method: "POST",
  body: { tenantId: "<tenant-id>" },
});
```

## Tenant model

| Field       | Type     | Description                       |
| ----------- | -------- | --------------------------------- |
| `id`        | `string` | Unique identifier                 |
| `name`      | `string` | Display name                      |
| `slug`      | `string` | URL-friendly unique identifier    |
| `metadata`  | `string` | Optional JSON-serialized metadata |
| `createdAt` | `Date`   | Creation timestamp                |
| `updatedAt` | `Date`   | Last update timestamp             |

See [Endpoints](/api/endpoints) for full request/response details.
