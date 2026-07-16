# Client plugin

Import the client plugin from `better-auth-tenancy/client`:

```ts
import { tenantAuthClient } from "better-auth-tenancy/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: "http://localhost:3000",
  plugins: [tenantAuthClient()],
});
```

## What it registers

### Path methods

The client plugin tells Better Auth which HTTP methods to use for each endpoint:

| Path                            | Method |
| ------------------------------- | ------ |
| `/tenant/create`                | POST   |
| `/tenant/get`                   | GET    |
| `/tenant/list`                  | GET    |
| `/tenant/update`                | POST   |
| `/tenant/delete`                | POST   |
| `/tenant/sign-up/email`         | POST   |
| `/tenant/sign-in/email`         | POST   |
| `/tenant/verify-email`          | GET    |
| `/tenant/sign-in/social`        | POST   |
| `/tenant/oauth-config/register` | POST   |
| `/tenant/oauth-config/list`     | GET    |
| `/tenant/oauth-config/delete`   | POST   |

### Session listeners

Sign-in and sign-up endpoints trigger the `$sessionSignal` atom listener so client session state updates automatically:

- `/tenant/sign-in/email`
- `/tenant/sign-up/email`
- `/tenant/sign-in/social`

### Type inference

`$InferServerPlugin` links the client to the server plugin's endpoint types for full type safety when using generated client methods.

## Calling endpoints

Use the typed client methods where available, or `$fetch` for management endpoints:

```ts
// Typed auth methods
await authClient.signUpEmailTenant({
  tenantId: "...",
  email: "user@example.com",
  password: "...",
  name: "Jane",
});

await authClient.signInEmailTenant({
  tenantId: "...",
  email: "user@example.com",
  password: "...",
});

await authClient.signInSocialTenant({
  tenantId: "...",
  provider: "google",
  callbackURL: "/welcome",
});

// Management via $fetch
await authClient.$fetch("/tenant/create", {
  method: "POST",
  body: { name: "Acme", slug: "acme" },
  headers: { "x-admin-key": adminSecret },
});
```

## Exports

```ts
export { tenantAuthClient, TENANT_AUTH_ERROR_CODES };
export type { Tenant, TenantAuthOptions, TenantOAuthConfig };
```
