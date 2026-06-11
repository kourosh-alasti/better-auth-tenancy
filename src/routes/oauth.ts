import type { GenericEndpointContext } from "@better-auth/core";
import type { OAuth2Tokens } from "@better-auth/core/oauth2";
import type { Account, User } from "better-auth";
import { generateState, parseState } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { setTokenUtil } from "better-auth/oauth2";
import * as z from "zod";
import { TENANT_AUTH_ERROR_CODES } from "./../error-codes";
import type { TenantAuthOptions, TenantOAuthConfig } from "./../types";
import {
  decryptCredential,
  encryptCredential,
  findTenantOAuthConfig,
  requireManagementAccess,
  requireTenant,
  resolveTenantProvider,
} from "./../utils";

/**
 * Shapes a config for API responses: drops the client secret entirely
 * and decrypts the client id so admins can identify the configuration.
 */
const toConfigOutput = async (ctx: GenericEndpointContext, config: TenantOAuthConfig) => {
  const { clientSecret: _clientSecret, ...rest } = config;
  return {
    ...rest,
    clientId: await decryptCredential(ctx, config.clientId),
  };
};

/**
 * Redirect the user to the OAuth error page with a machine-readable
 * `error` code (and optional `error_description`).
 */
function redirectOnError(
  ctx: GenericEndpointContext,
  errorURL: string,
  error: string,
  description?: string,
): never {
  const params = new URLSearchParams({ error });
  if (description) params.set("error_description", description);
  const sep = errorURL.includes("?") ? "&" : "?";
  throw ctx.redirect(`${errorURL}${sep}${params.toString()}`);
}

export const registerTenantOAuthConfig = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/oauth-config/register",
    {
      method: "POST",
      operationId: "registerTenantOAuthConfig",
      body: z.object({
        tenantId: z.string().meta({ description: "The id of the tenant" }).optional(),
        providerId: z.string().meta({
          description: "The id of a built-in social provider (e.g. google)",
        }),
        clientId: z.string().meta({ description: "The OAuth client id for this tenant" }),
        clientSecret: z.string().meta({ description: "The OAuth client secret for this tenant" }),
        scopes: z
          .array(z.string())
          .meta({ description: "Scopes to request from the provider" })
          .optional(),
        redirectURI: z
          .string()
          .meta({ description: "Override the redirect URI for this provider" })
          .optional(),
        enabled: z
          .boolean()
          .meta({ description: "Whether this configuration is enabled" })
          .optional(),
      }),
      metadata: {
        openapi: {
          operationId: "registerTenantOAuthConfig",
          description: "Create or update a per-tenant OAuth provider configuration",
        },
      },
    },
    async (ctx) => {
      await requireManagementAccess(ctx, options);
      const tenant = await requireTenant(ctx, options);
      const existing = await findTenantOAuthConfig(ctx, tenant.id, ctx.body.providerId);
      // Credentials are encrypted at rest with the auth secret.
      const data = {
        clientId: await encryptCredential(ctx, ctx.body.clientId),
        clientSecret: await encryptCredential(ctx, ctx.body.clientSecret),
        scopes: ctx.body.scopes?.join(",") ?? null,
        redirectURI: ctx.body.redirectURI ?? null,
        enabled: ctx.body.enabled ?? true,
        updatedAt: new Date(),
      };
      if (existing) {
        const updated = await ctx.context.adapter.update<TenantOAuthConfig>({
          model: "tenantOauthConfig",
          where: [{ field: "id", value: existing.id }],
          update: data,
        });
        return ctx.json(await toConfigOutput(ctx, updated ?? { ...existing, ...data }));
      }
      const created = await ctx.context.adapter.create<
        Omit<TenantOAuthConfig, "id">,
        TenantOAuthConfig
      >({
        model: "tenantOauthConfig",
        data: {
          tenantId: tenant.id,
          providerId: ctx.body.providerId,
          ...data,
          createdAt: new Date(),
        },
      });
      return ctx.json(await toConfigOutput(ctx, created));
    },
  );

export const listTenantOAuthConfigs = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/oauth-config/list",
    {
      method: "GET",
      operationId: "listTenantOAuthConfigs",
      query: z.object({
        tenantId: z.string().meta({ description: "The id of the tenant" }).optional(),
      }),
      metadata: {
        openapi: {
          operationId: "listTenantOAuthConfigs",
          description: "List the OAuth provider configurations of a tenant",
        },
      },
    },
    async (ctx) => {
      await requireManagementAccess(ctx, options);
      const tenant = await requireTenant(ctx, options);
      const configs = await ctx.context.adapter.findMany<TenantOAuthConfig>({
        model: "tenantOauthConfig",
        where: [{ field: "tenantId", value: tenant.id }],
      });
      return ctx.json(await Promise.all(configs.map((config) => toConfigOutput(ctx, config))));
    },
  );

export const deleteTenantOAuthConfig = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/oauth-config/delete",
    {
      method: "POST",
      operationId: "deleteTenantOAuthConfig",
      body: z.object({
        tenantId: z.string().meta({ description: "The id of the tenant" }).optional(),
        providerId: z.string().meta({ description: "The id of the provider" }),
      }),
      metadata: {
        openapi: {
          operationId: "deleteTenantOAuthConfig",
          description: "Delete a per-tenant OAuth provider configuration",
        },
      },
    },
    async (ctx) => {
      await requireManagementAccess(ctx, options);
      const tenant = await requireTenant(ctx, options);
      const existing = await findTenantOAuthConfig(ctx, tenant.id, ctx.body.providerId);
      if (!existing) {
        throw APIError.from("NOT_FOUND", TENANT_AUTH_ERROR_CODES.OAUTH_CONFIG_NOT_FOUND);
      }
      await ctx.context.adapter.delete({
        model: "tenantOauthConfig",
        where: [{ field: "id", value: existing.id }],
      });
      return ctx.json({ success: true });
    },
  );

export const signInSocialTenant = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/sign-in/social",
    {
      method: "POST",
      operationId: "tenantSignInSocial",
      body: z.object({
        tenantId: z
          .string()
          .meta({ description: "The id of the tenant to sign in under" })
          .optional(),
        provider: z.string().meta({
          description: "The id of the social provider to sign in with",
        }),
        callbackURL: z
          .string()
          .meta({
            description: "Callback URL to redirect to after the user has signed in",
          })
          .optional(),
        newUserCallbackURL: z
          .string()
          .meta({
            description: "Callback URL to redirect to if the user is newly registered",
          })
          .optional(),
        errorCallbackURL: z
          .string()
          .meta({
            description: "Callback URL to redirect to if an error happens",
          })
          .optional(),
        disableRedirect: z
          .boolean()
          .meta({
            description: "Disable automatic redirection to the provider",
          })
          .optional(),
        scopes: z
          .array(z.string())
          .meta({
            description:
              "Array of scopes to request from the provider. Overrides the default scopes.",
          })
          .optional(),
        requestSignUp: z.boolean().meta({ description: "Explicitly request sign-up" }).optional(),
        loginHint: z
          .string()
          .meta({
            description: "The login hint to use for the authorization code request",
          })
          .optional(),
      }),
      metadata: {
        openapi: {
          operationId: "tenantSignInSocial",
          description: "Sign in with a social provider using the tenant's OAuth configuration",
        },
      },
    },
    async (ctx) => {
      const tenant = await requireTenant(ctx, options);
      const { provider, redirectURI } = await resolveTenantProvider(
        ctx,
        tenant.id,
        ctx.body.provider,
      );
      const { codeVerifier, state } = await generateState(ctx, undefined, {
        tenantId: tenant.id,
      });
      const url = await provider.createAuthorizationURL({
        state,
        codeVerifier,
        redirectURI,
        scopes: ctx.body.scopes,
        loginHint: ctx.body.loginHint,
      });
      if (!ctx.body.disableRedirect) {
        ctx.setHeader("Location", url.toString());
      }
      return ctx.json({
        url: url.toString(),
        redirect: !ctx.body.disableRedirect,
      });
    },
  );

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  error: z.string().optional(),
  device_id: z.string().optional(),
  error_description: z.string().optional(),
  state: z.string().optional(),
});

export const callbackTenantOAuth = (_options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/callback/:providerId",
    {
      method: ["GET", "POST"],
      operationId: "tenantOAuthCallback",
      body: callbackQuerySchema.optional(),
      query: callbackQuerySchema.optional(),
      metadata: {
        isAction: false,
        allowedMediaTypes: ["application/x-www-form-urlencoded", "application/json"],
      },
    },
    async (ctx) => {
      const defaultErrorURL =
        ctx.context.options.onAPIError?.errorURL || `${ctx.context.baseURL}/error`;

      // Handle POST requests by redirecting to GET so cookies are sent.
      if (ctx.method === "POST") {
        const postData = ctx.body ? callbackQuerySchema.parse(ctx.body) : {};
        const queryData = ctx.query ? callbackQuerySchema.parse(ctx.query) : {};
        const mergedData = { ...postData, ...queryData };
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(mergedData)) {
          if (value !== undefined && value !== null) {
            params.set(key, String(value));
          }
        }
        throw ctx.redirect(
          `${ctx.context.baseURL}/tenant/callback/${ctx.params.providerId}?${params.toString()}`,
        );
      }

      const { code, error, error_description, device_id } = callbackQuerySchema.parse(
        ctx.query ?? {},
      );

      const parsedState = await parseState(ctx);
      const { callbackURL, codeVerifier, errorURL, newUserURL, requestSignUp } = parsedState;
      const tenantId = (parsedState as Record<string, unknown>).tenantId as string | undefined;
      const resolvedErrorURL = errorURL || defaultErrorURL;

      if (error) {
        redirectOnError(ctx, resolvedErrorURL, error, error_description);
      }
      if (!code) {
        redirectOnError(ctx, resolvedErrorURL, "no_code");
      }
      if (!tenantId) {
        redirectOnError(ctx, resolvedErrorURL, "tenant_not_found");
      }

      const providerId = ctx.params.providerId;
      let provider: Awaited<ReturnType<typeof resolveTenantProvider>>["provider"];
      let redirectURI: string;
      try {
        const resolved = await resolveTenantProvider(ctx, tenantId, providerId);
        provider = resolved.provider;
        redirectURI = resolved.redirectURI;
      } catch (e) {
        ctx.context.logger.error("Unable to resolve tenant provider", e);
        redirectOnError(ctx, resolvedErrorURL, "oauth_provider_not_found");
      }

      let tokens: OAuth2Tokens | null;
      try {
        tokens = await provider.validateAuthorizationCode({
          code,
          codeVerifier,
          deviceId: device_id,
          redirectURI,
        });
      } catch (e) {
        ctx.context.logger.error("Failed to validate authorization code", e);
        redirectOnError(ctx, resolvedErrorURL, "invalid_code");
      }
      if (!tokens) {
        redirectOnError(ctx, resolvedErrorURL, "invalid_code");
      }

      const userInfo = await provider.getUserInfo(tokens).then((res) => res?.user);
      if (!userInfo || userInfo.id === undefined || userInfo.id === null || userInfo.id === "") {
        ctx.context.logger.error("Unable to get user info");
        redirectOnError(ctx, resolvedErrorURL, "unable_to_get_user_info");
      }
      if (!userInfo.email) {
        ctx.context.logger.error(`Provider ${providerId} did not return an email`);
        redirectOnError(ctx, resolvedErrorURL, "email_not_found");
      }
      if (!callbackURL) {
        redirectOnError(ctx, resolvedErrorURL, "no_callback_url");
      }

      const providerAccountId = String(userInfo.id);
      const email = userInfo.email.toLowerCase();

      const freshTokens = Object.fromEntries(
        Object.entries({
          accessToken: await setTokenUtil(tokens.accessToken, ctx.context),
          refreshToken: await setTokenUtil(tokens.refreshToken, ctx.context),
          idToken: tokens.idToken,
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
          scope: tokens.scopes?.join(","),
        }).filter(([_, value]) => value !== undefined),
      ) as Record<string, string | Date>;

      let user: User | null = null;
      let isRegister = false;

      const existingAccount = await ctx.context.adapter.findOne<Account>({
        model: "account",
        where: [
          { field: "accountId", value: providerAccountId },
          { field: "providerId", value: providerId },
          { field: "tenantId", value: tenantId },
        ],
      });

      if (existingAccount) {
        user = await ctx.context.adapter.findOne<User>({
          model: "user",
          where: [{ field: "id", value: existingAccount.userId }],
        });
        if (!user) {
          redirectOnError(ctx, resolvedErrorURL, "user_not_found");
        }
        if (Object.keys(freshTokens).length > 0) {
          await ctx.context.internalAdapter.updateAccount(existingAccount.id, freshTokens);
        }
      } else {
        const existingUser = await ctx.context.adapter.findOne<User>({
          model: "user",
          where: [
            { field: "email", value: email },
            { field: "tenantId", value: tenantId },
          ],
        });
        if (existingUser) {
          // Implicit account linking: only link when the provider verified
          // the email or the provider is explicitly trusted.
          const isTrustedProvider = ctx.context.trustedProviders.includes(providerId);
          if (
            (!isTrustedProvider && !userInfo.emailVerified) ||
            ctx.context.options.account?.accountLinking?.enabled === false
          ) {
            ctx.context.logger.error("Unable to link account - untrusted provider");
            redirectOnError(ctx, resolvedErrorURL, "unable_to_link_account");
          }
          await ctx.context.internalAdapter.createAccount({
            userId: existingUser.id,
            providerId,
            accountId: providerAccountId,
            ...freshTokens,
            tenantId,
          });
          user = existingUser;
        } else {
          if (provider.disableImplicitSignUp && !requestSignUp) {
            redirectOnError(ctx, resolvedErrorURL, "signup_disabled");
          }
          isRegister = true;
          try {
            user = await ctx.context.internalAdapter.createUser({
              email,
              name: userInfo.name || "",
              ...(userInfo.image ? { image: userInfo.image } : {}),
              emailVerified: userInfo.emailVerified || false,
              tenantId,
            });
            await ctx.context.internalAdapter.createAccount({
              userId: user.id,
              providerId,
              accountId: providerAccountId,
              ...freshTokens,
              tenantId,
            });
          } catch (e) {
            ctx.context.logger.error("Unable to create user", e);
            redirectOnError(ctx, resolvedErrorURL, "unable_to_create_user");
          }
        }
      }

      const session = await ctx.context.internalAdapter.createSession(user.id, undefined, {
        tenantId,
      });
      if (!session) {
        redirectOnError(ctx, resolvedErrorURL, "unable_to_create_session");
      }
      await setSessionCookie(ctx, { session, user });

      throw ctx.redirect(isRegister ? newUserURL || callbackURL : callbackURL);
    },
  );
