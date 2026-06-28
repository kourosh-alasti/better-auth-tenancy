# Schema

The plugin extends the Better Auth database schema via `mergeSchema`.

## `tenant`

| Field       | Type     | Notes                           |
| ----------- | -------- | ------------------------------- |
| `id`        | `string` | Primary key (adapter default)   |
| `name`      | `string` | Required, sortable              |
| `slug`      | `string` | Required, unique, sortable      |
| `metadata`  | `string` | Optional JSON string            |
| `createdAt` | `date`   | Default: now                    |
| `updatedAt` | `date`   | Default: now, updated on change |

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

## Extended core tables

### `user`

Adds:

| Field      | Type     | Notes                                     |
| ---------- | -------- | ----------------------------------------- |
| `tenantId` | `string` | FK → `tenant.id`, cascade delete, indexed |

When `keepEmailGloballyUnique` is `false` (default), the global unique constraint on `email` is removed. Per-tenant email uniqueness is enforced by plugin endpoints.

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
interface Tenant {
  id: string;
  name: string;
  slug: string;
  metadata?: string | null;
  createdAt: Date;
  updatedAt: Date;
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
