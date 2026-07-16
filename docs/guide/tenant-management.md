# Tenant management

The plugin exposes CRUD endpoints for tenants and platform-user memberships.

## Authorization

Management access is resolved in this order:

1. **`canManageTenants` returns `true`** — global admin (e.g. operator API key). Can create and manage every tenant.
2. **Authenticated platform user** — a session whose `user.tenantId` is null. Access is scoped by **membership role**.
3. **Otherwise** — denied.

Tenant end-users (`user.tenantId` set) cannot create or manage tenants.

### Roles

| Role     | Update tenant | Delete tenant | OAuth configs | Manage members           |
| -------- | ------------- | ------------- | ------------- | ------------------------ |
| `owner`  | yes           | yes           | yes           | yes (any role)           |
| `admin`  | yes           | no            | yes           | add/remove `member` only |
| `member` | no            | no            | no            | list members only        |

Creating a tenant attaches the platform user as `owner` (`ownerId` + `tenantMember` row).

## Create a tenant

```ts
const { data: tenant } = await authClient.$fetch("/tenant/create", {
  method: "POST",
  body: {
    name: "Acme Corp",
    slug: "acme",
    metadata: { plan: "pro" },
  },
});
// tenant.ownerId === current platform user id
```

## Members

```ts
// Add by user id or email (platform users only)
await auth.api.addTenantMember({
  body: { tenantId: tenant.id, email: "partner@platform.com", role: "admin" },
  headers,
});

await auth.api.listTenantMembers({
  query: { tenantId: tenant.id },
  headers,
});

await auth.api.updateTenantMember({
  body: { tenantId: tenant.id, userId: "...", role: "member" },
  headers,
});

await auth.api.removeTenantMember({
  body: { tenantId: tenant.id, userId: "..." },
  headers,
});
```

The last `owner` cannot be removed or demoted.

## Get / list / update / delete

- **Get** by id or slug is public.
- **List** returns all tenants for global admin; otherwise tenants the caller is a member of.
- **Update** requires `admin` or higher.
- **Delete** requires `owner` (or global admin). Cascades related users, sessions, accounts, members, and OAuth configs.

```ts
await authClient.$fetch("/tenant/update", {
  method: "POST",
  body: {
    id: "<tenant-id>",
    data: { name: "Acme Inc", slug: "acme-inc" },
  },
});

await authClient.$fetch("/tenant/delete", {
  method: "POST",
  body: { id: "<tenant-id>" },
});
```

## Tenant model

| Field       | Type     | Description                             |
| ----------- | -------- | --------------------------------------- |
| `id`        | `string` | Unique identifier                       |
| `name`      | `string` | Display name                            |
| `slug`      | `string` | URL-friendly unique identifier          |
| `ownerId`   | `string` | Primary platform owner (`null` if none) |
| `metadata`  | `string` | Optional JSON-serialized metadata       |
| `createdAt` | `Date`   | Creation timestamp                      |
| `updatedAt` | `Date`   | Last update timestamp                   |

## Member model

| Field       | Type     | Description                    |
| ----------- | -------- | ------------------------------ |
| `id`        | `string` | Unique identifier              |
| `tenantId`  | `string` | Tenant                         |
| `userId`    | `string` | Platform user                  |
| `role`      | `string` | `owner` \| `admin` \| `member` |
| `createdAt` | `Date`   | Creation timestamp             |

See [Endpoints](/api/endpoints) for full request/response details.
