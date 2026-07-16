# Schema

The plugin extends the Better Auth database schema via `mergeSchema`.

## `tenant`

| Field       | Type     | Notes                                               |
| ----------- | -------- | --------------------------------------------------- |
| `id`        | `string` | Primary key (adapter default)                       |
| `name`      | `string` | Required, sortable                                  |
| `slug`      | `string` | Required, unique, sortable                          |
| `ownerId`   | `string` | Optional FK → `user.id`, indexed, onDelete set null |
| `metadata`  | `string` | Optional JSON string                                |
| `createdAt` | `date`   | Default: now                                        |
| `updatedAt` | `date`   | Default: now, updated on change                     |

## `tenantMember`

Platform users who manage a tenant (not tenant end-users).

| Field       | Type     | Notes                                     |
| ----------- | -------- | ----------------------------------------- |
| `id`        | `string` | Primary key                               |
| `tenantId`  | `string` | FK → `tenant.id`, cascade delete, indexed |
| `userId`    | `string` | FK → `user.id`, cascade delete, indexed   |
| `role`      | `string` | `owner` \| `admin` \| `member` (default)  |
| `createdAt` | `date`   | Default: now                              |

Add a unique index on `(tenantId, userId)` in your ORM (Better Auth does not emit composite uniques).

## `tenantOauthConfig`

| Field          | Type      | Notes                                    |
| -------------- | --------- | ---------------------------------------- |
| `id`           | `string`  | Primary key                              |
| `tenantId`     | `string`  | FK → `tenant.id`, cascade delete         |
| `providerId`   | `string`  | Built-in provider id (e.g. `google`)     |
| `clientId`     | `string`  | Encrypted at rest                        |
| `clientSecret` | `string`  | Encrypted at rest, never returned by API |
| `scopes`       | `string`  | Comma-separated scopes                   |
| `redirectURI`  | `string`  | Optional override                        |
| `enabled`      | `boolean` | Default `true`                           |
| `createdAt`    | `date`    | Default: now                             |
| `updatedAt`    | `date`    | Default: now, updated on change          |

Add a unique index on `(tenantId, providerId)` in your ORM.

## Extended core tables

### `user`

Adds:

| Field      | Type     | Notes                                     |
| ---------- | -------- | ----------------------------------------- |
| `tenantId` | `string` | FK → `tenant.id`, cascade delete, indexed |

When `keepEmailGloballyUnique` is `false` (default), the global unique constraint on `email` is removed. **You must add composite / partial unique indexes** in your database — Better Auth’s schema DSL cannot emit them:

```sql
-- Platform users (tenant_id IS NULL)
CREATE UNIQUE INDEX user_email_platform_unique
  ON "user" (email) WHERE tenant_id IS NULL;

-- Tenant users
CREATE UNIQUE INDEX user_email_tenant_unique
  ON "user" (email, tenant_id) WHERE tenant_id IS NOT NULL;
```

The Next.js demo’s Drizzle schema includes these indexes.

### `session`

Adds:

| Field      | Type     | Notes                                     |
| ---------- | -------- | ----------------------------------------- |
| `tenantId` | `string` | FK → `tenant.id`, cascade delete, indexed |

### `account`

Adds:

| Field      | Type     | Notes                                     |
| ---------- | -------- | ----------------------------------------- |
| `tenantId` | `string` | FK → `tenant.id`, cascade delete, indexed |

### `verification`

Adds:

| Field      | Type     | Notes   |
| ---------- | -------- | ------- |
| `tenantId` | `string` | Indexed |

## Custom schema

Pass a `schema` option to rename models or fields:

```ts
tenantAuth({
  schema: {
    tenant: {
      modelName: "organization",
    },
  },
});
```

The plugin merges your overrides with the default schema. Foreign key references respect custom model names.

## TypeScript types

```ts
type TenantRole = "owner" | "admin" | "member";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  ownerId?: string | null;
  metadata?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TenantMember {
  id: string;
  tenantId: string;
  userId: string;
  role: TenantRole;
  createdAt: Date;
}

interface TenantOAuthConfig {
  id: string;
  tenantId: string;
  providerId: string;
  clientId: string;
  clientSecret: string;
  scopes?: string | null;
  redirectURI?: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

Exported from `better-auth-tenancy` and `better-auth-tenancy/client`.
