# Endpoints

All endpoints are mounted under your Better Auth base path (e.g. `/api/auth`).

## Tenant management

Requires management authorization unless noted.

### `POST /tenant/create`

Create a new tenant.

**Body**

| Field      | Type     | Required | Description             |
| ---------- | -------- | -------- | ----------------------- |
| `name`     | `string` | yes      | Display name            |
| `slug`     | `string` | yes      | Unique URL-friendly id  |
| `metadata` | `object` | no       | Arbitrary JSON metadata |

**Response:** Tenant object

---

### `GET /tenant/get`

Get a tenant by id or slug.

**Query**

| Field  | Type     | Required | Description |
| ------ | -------- | -------- | ----------- |
| `id`   | `string` | one of   | Tenant id   |
| `slug` | `string` | one of   | Tenant slug |

**Response:** Tenant object

---

### `GET /tenant/list`

List all tenants.

**Response:** Array of tenant objects

---

### `POST /tenant/update`

Update a tenant.

**Body**

| Field      | Type     | Required | Description      |
| ---------- | -------- | -------- | ---------------- |
| `tenantId` | `string` | yes      | Tenant to update |
| `name`     | `string` | no       | New display name |
| `slug`     | `string` | no       | New slug         |
| `metadata` | `object` | no       | New metadata     |

**Response:** Updated tenant object

---

### `POST /tenant/delete`

Delete a tenant and cascade related records.

**Body**

| Field      | Type     | Required | Description      |
| ---------- | -------- | -------- | ---------------- |
| `tenantId` | `string` | yes      | Tenant to delete |

**Response:** `{ success: true }`

## Email auth

### `POST /tenant/sign-up/email`

Sign up a user under a tenant.

**Body**

| Field         | Type      | Required | Description                     |
| ------------- | --------- | -------- | ------------------------------- |
| `tenantId`    | `string`  | no\*     | Tenant id                       |
| `name`        | `string`  | yes      | User display name               |
| `email`       | `string`  | yes      | Email address                   |
| `password`    | `string`  | yes      | Password                        |
| `image`       | `string`  | no       | Profile image URL               |
| `callbackURL` | `string`  | no       | Email verification callback     |
| `rememberMe`  | `boolean` | no       | Remember session (default true) |

\*Required unless resolved via header or `resolveTenantId`.

**Response:** User and session (when verification not required)

---

### `POST /tenant/sign-in/email`

Sign in a user under a tenant.

**Body**

| Field         | Type      | Required | Description                     |
| ------------- | --------- | -------- | ------------------------------- |
| `tenantId`    | `string`  | no\*     | Tenant id                       |
| `email`       | `string`  | yes      | Email address                   |
| `password`    | `string`  | yes      | Password                        |
| `callbackURL` | `string`  | no       | Redirect after sign-in          |
| `rememberMe`  | `boolean` | no       | Remember session (default true) |

**Response:** User and session

## OAuth configuration

Requires management authorization.

### `POST /tenant/oauth-config/register`

Create or update a per-tenant OAuth provider config.

**Body**

| Field          | Type       | Required | Description             |
| -------------- | ---------- | -------- | ----------------------- |
| `tenantId`     | `string`   | no\*     | Tenant id               |
| `providerId`   | `string`   | yes      | e.g. `google`, `github` |
| `clientId`     | `string`   | yes      | OAuth client id         |
| `clientSecret` | `string`   | yes      | OAuth client secret     |
| `scopes`       | `string[]` | no       | Requested scopes        |
| `redirectURI`  | `string`   | no       | Override redirect URI   |
| `enabled`      | `boolean`  | no       | Default `true`          |

**Response:** Config object (no client secret)

---

### `GET /tenant/oauth-config/list`

List OAuth configs for a tenant.

**Query**

| Field      | Type     | Required | Description |
| ---------- | -------- | -------- | ----------- |
| `tenantId` | `string` | no\*     | Tenant id   |

**Response:** Array of config objects (secrets omitted)

---

### `POST /tenant/oauth-config/delete`

Delete a tenant OAuth config.

**Body**

| Field        | Type     | Required | Description        |
| ------------ | -------- | -------- | ------------------ |
| `tenantId`   | `string` | no\*     | Tenant id          |
| `providerId` | `string` | yes      | Provider to remove |

**Response:** `{ success: true }`

## OAuth sign-in

### `POST /tenant/sign-in/social`

Start OAuth sign-in for a tenant.

**Body**

| Field              | Type     | Required | Description      |
| ------------------ | -------- | -------- | ---------------- |
| `tenantId`         | `string` | no\*     | Tenant id        |
| `provider`         | `string` | yes      | Provider id      |
| `callbackURL`      | `string` | no       | Success redirect |
| `errorCallbackURL` | `string` | no       | Error redirect   |

**Response:** Redirect to OAuth provider

---

### `GET /tenant/callback/{providerId}`

OAuth callback handler. Creates a session with `tenantId` and redirects to `callbackURL`.

## Tenant id resolution

For endpoints marked with `*`, `tenantId` can be omitted when resolved via:

1. `resolveTenantId` option
2. Request body `tenantId`
3. Query `tenantId`
4. Header (default `x-tenant-id`)

See [Configuration](/guide/configuration).
