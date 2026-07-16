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

## Email verification

Verification tokens issued by `signUpEmailTenant` / `signInEmailTenant` carry the tenant id as a claim (`createEmailVerificationToken(secret, email, undefined, expiresIn, { tenantId })`) and link to a **plugin** endpoint, `GET /tenant/verify-email`, instead of core's `/verify-email`.

This matters because core's `/verify-email` looks up the user by email alone. With the same email registered under two tenants, core would verify whichever user it finds first — the wrong one, half the time. `/tenant/verify-email` looks the user up by **email and tenant id**, so it always verifies the correct tenant-scoped user.

```
GET /tenant/verify-email?token=<token>&callbackURL=<optional>
```

- Verifies the JWT with the same secret as core, then requires an `email` and `tenantId` claim — tokens without a `tenantId` (i.e. issued by core) are rejected with `INVALID_VERIFICATION_TOKEN`.
- Looks up the user by `email` + `tenantId` and sets `emailVerified: true`.
- Redirects to `callbackURL` on success/error when provided (like core), otherwise returns `{ status, user }` as JSON.
- Honors `emailVerification.beforeEmailVerification`, `afterEmailVerification`, and `autoSignInAfterVerification` the same way core's `/verify-email` does.

As a safety net, the plugin also rejects any tenant-issued token (one with a `tenantId` claim) that's replayed against core's `/verify-email` — so a tenant verification link can never end up verifying the wrong user even if it's misrouted.

## Callback URL validation

`callbackURL` (on both sign-up and sign-in) is checked against your Better Auth `trustedOrigins` before it's used — as the `Location` redirect on sign-in, and before it's embedded in a verification email link. Relative paths (e.g. `/dashboard`) are always allowed; absolute URLs must match a configured trusted origin or the request is rejected with `INVALID_CALLBACK_URL`.

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
| `INVALID_CALLBACK_URL`       | `callbackURL` isn't a trusted origin     |
| `INVALID_VERIFICATION_TOKEN` | Token missing/wrong tenant claim         |

See [Error codes](/api/error-codes) for the full list.
