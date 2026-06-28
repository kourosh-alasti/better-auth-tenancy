# Email auth

Tenant-scoped email and password sign-up and sign-in. Requires `emailAndPassword.enabled: true` in your Better Auth config.

## Sign up

```ts
await authClient.signUpEmailTenant({
  tenantId: "<tenant-id>",
  email: "user@example.com",
  password: "secure-password",
  name: "Jane Doe",
  image: "https://example.com/avatar.png", // optional
  callbackURL: "/welcome", // optional, for email verification
  rememberMe: true, // optional, default true
});
```

Endpoint: `POST /tenant/sign-up/email`

The user is created with `tenantId` set and an email/password account linked to that tenant. If email verification is enabled, a verification email is sent using your configured `sendVerificationEmail` handler.

## Sign in

```ts
await authClient.signInEmailTenant({
  tenantId: "<tenant-id>",
  email: "user@example.com",
  password: "secure-password",
  rememberMe: true, // optional
  callbackURL: "/dashboard", // optional
});
```

Endpoint: `POST /tenant/sign-in/email`

Sign-in validates credentials against the user record **for that tenant only**. The same email under a different tenant is a separate user with its own password.

## Resolving the tenant

Pass `tenantId` in the request body, or use one of these alternatives:

- **`x-tenant-id` header** (or your custom `tenantHeader`)
- **`resolveTenantId` callback** — e.g. resolve from `x-tenant-slug` (see [Configuration](/guide/configuration))

## Multi-tenant email demo

1. Create tenants `tenant-a` and `tenant-b`
2. Sign up `shared@demo.com` on each with different passwords
3. Sign in to `tenant-a` only works with tenant-a's password, and likewise for tenant-b

## Session

After sign-in or sign-up, the session includes `tenantId`. Use it to scope application data and authorization:

```ts
const { data: session } = await authClient.getSession();
console.log(session?.tenantId);
```

## Related errors

| Code                         | Meaning                                  |
| ---------------------------- | ---------------------------------------- |
| `USER_ALREADY_EXISTS`        | Email already registered for this tenant |
| `INVALID_EMAIL_OR_PASSWORD`  | Wrong credentials for this tenant        |
| `EMAIL_NOT_VERIFIED`         | Email verification required              |
| `EMAIL_PASSWORD_NOT_ENABLED` | Email/password auth disabled in config   |
| `TENANT_NOT_FOUND`           | Invalid or missing tenant id             |

See [Error codes](/api/error-codes) for the full list.
