# OAuth

Configure OAuth providers per tenant. Credentials are encrypted at rest with your Better Auth secret. When no tenant-specific config exists, the plugin falls back to globally configured social providers.

## Global fallback

Configure social providers in your Better Auth config as usual:

```ts
betterAuth({
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  plugins: [tenantAuth()],
});
```

Tenants without their own OAuth config use these global credentials. The callback URL is:

```
{baseURL}/tenant/callback/{providerId}
```

For example: `http://localhost:3000/api/auth/tenant/callback/google` when Better Auth is mounted at `/api/auth`.

## Register per-tenant OAuth config

Requires management access (see [Configuration](/guide/configuration)).

```ts
await authClient.$fetch("/tenant/oauth-config/register", {
  method: "POST",
  body: {
    tenantId: "<tenant-id>",
    providerId: "google",
    clientId: "your-client-id",
    clientSecret: "your-client-secret",
    scopes: ["email", "profile"], // optional
    redirectURI: "https://app.example.com/api/auth/tenant/callback/google", // optional
    enabled: true, // optional, default true
  },
});
```

Registering again for the same tenant + provider upserts the existing config.

## List OAuth configs

Returns configs without client secrets. Client ids are decrypted for display.

```ts
await authClient.$fetch("/tenant/oauth-config/list?tenantId=<tenant-id>");
```

## Delete OAuth config

```ts
await authClient.$fetch("/tenant/oauth-config/delete", {
  method: "POST",
  body: {
    tenantId: "<tenant-id>",
    providerId: "google",
  },
});
```

## Social sign-in

Start the OAuth flow for a tenant:

```ts
await authClient.signInSocialTenant({
  tenantId: "<tenant-id>",
  provider: "google",
  callbackURL: "/welcome", // where to redirect after success
  errorCallbackURL: "/error", // optional
});
```

Endpoint: `POST /tenant/sign-in/social`

The plugin resolves the provider from the tenant's database config first, then from global `socialProviders`.

## Callback

The OAuth callback is handled at:

```
GET /tenant/callback/{providerId}
```

On success, a session is created with `tenantId` set and the user is redirected to `callbackURL`. On failure, the user is redirected to the error URL with `error` and optional `error_description` query parameters.

## Provider resolution order

1. Tenant's `tenantOauthConfig` row (if enabled)
2. Global social provider from Better Auth config
3. `PROVIDER_NOT_FOUND` error if neither exists

Only built-in Better Auth social providers (e.g. `google`, `github`) are supported for per-tenant configuration.

## Security notes

- Client secrets are never returned by list/get endpoints
- Credentials are encrypted with `symmetricEncrypt` using your auth secret
- Register redirect URIs in your OAuth provider's console for each tenant if using custom redirect URIs

See [Endpoints](/api/endpoints) and the [Next.js demo](/examples/nextjs) for a complete OAuth walkthrough.
