import type { GenericEndpointContext } from "@better-auth/core";
import type { Account, User } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createEmailVerificationToken,
  originCheck,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";
import { TENANT_AUTH_ERROR_CODES } from "./../error-codes";
import type { TenantAuthOptions } from "./../types";
import { assertTrustedRedirectURL, isUniqueConstraintError, requireTenant } from "./../utils";

const findTenantUserByEmail = async (
  ctx: GenericEndpointContext,
  email: string,
  tenantId: string,
) => {
  return await ctx.context.adapter.findOne<User & { tenantId?: string }>({
    model: "user",
    where: [
      { field: "email", value: email.toLowerCase() },
      { field: "tenantId", value: tenantId },
    ],
  });
};

export const signUpEmailTenant = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/sign-up/email",
    {
      method: "POST",
      operationId: "tenantSignUpEmail",
      body: z.object({
        tenantId: z
          .string()
          .meta({ description: "The id of the tenant to sign up under" })
          .optional(),
        name: z.string().meta({ description: "The name of the user" }),
        email: z.email().meta({ description: "The email of the user" }),
        password: z.string().nonempty().meta({ description: "The password of the user" }),
        image: z.string().meta({ description: "The profile image URL of the user" }).optional(),
        callbackURL: z
          .string()
          .meta({
            description: "The URL to use for email verification callback",
          })
          .optional(),
        rememberMe: z
          .boolean()
          .meta({
            description: "If this is false, the session will not be remembered. Default is `true`.",
          })
          .optional(),
      }),
      use: [originCheck((ctx) => ctx.body?.callbackURL)],
      metadata: {
        openapi: {
          operationId: "tenantSignUpEmail",
          description: "Sign up a user under a tenant using email and password",
        },
      },
    },
    async (ctx) => {
      if (ctx.context.options.emailAndPassword?.enabled === false) {
        throw APIError.from("BAD_REQUEST", TENANT_AUTH_ERROR_CODES.EMAIL_PASSWORD_NOT_ENABLED);
      }
      assertTrustedRedirectURL(ctx, ctx.body.callbackURL);
      const tenant = await requireTenant(ctx, options);
      const { name, email, password, image, rememberMe } = ctx.body;

      const minPasswordLength = ctx.context.password.config.minPasswordLength;
      if (password.length < minPasswordLength) {
        throw APIError.from("BAD_REQUEST", {
          message: "Password is too short",
          code: "PASSWORD_TOO_SHORT",
        });
      }
      const maxPasswordLength = ctx.context.password.config.maxPasswordLength;
      if (password.length > maxPasswordLength) {
        throw APIError.from("BAD_REQUEST", {
          message: "Password is too long",
          code: "PASSWORD_TOO_LONG",
        });
      }

      const normalizedEmail = email.toLowerCase();
      const existingUser = await findTenantUserByEmail(ctx, normalizedEmail, tenant.id);
      if (existingUser) {
        throw APIError.from("UNPROCESSABLE_ENTITY", TENANT_AUTH_ERROR_CODES.USER_ALREADY_EXISTS);
      }

      const hash = await ctx.context.password.hash(password);
      let createdUser;
      try {
        createdUser = await ctx.context.internalAdapter.createUser({
          email: normalizedEmail,
          name,
          image,
          emailVerified: false,
          tenantId: tenant.id,
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw APIError.from("UNPROCESSABLE_ENTITY", TENANT_AUTH_ERROR_CODES.USER_ALREADY_EXISTS);
        }
        throw error;
      }
      if (!createdUser) {
        throw APIError.from("UNPROCESSABLE_ENTITY", TENANT_AUTH_ERROR_CODES.FAILED_TO_CREATE_USER);
      }
      await ctx.context.internalAdapter.createAccount({
        userId: createdUser.id,
        providerId: "credential",
        accountId: createdUser.id,
        password: hash,
        tenantId: tenant.id,
      });

      const shouldSendVerificationEmail =
        ctx.context.options.emailVerification?.sendOnSignUp ??
        ctx.context.options.emailAndPassword?.requireEmailVerification;
      if (
        shouldSendVerificationEmail &&
        ctx.context.options.emailVerification?.sendVerificationEmail
      ) {
        const token = await createEmailVerificationToken(
          ctx.context.secret,
          createdUser.email,
          undefined,
          ctx.context.options.emailVerification?.expiresIn,
          { tenantId: tenant.id },
        );
        const callbackURL = encodeURIComponent(ctx.body.callbackURL || "/");
        // Tenant-scoped tokens must be verified by `/tenant/verify-email`,
        // not core's `/verify-email` — core only looks up users by email
        // and would verify the wrong user when the same email exists
        // under multiple tenants.
        const url = `${ctx.context.baseURL}/tenant/verify-email?token=${token}&callbackURL=${callbackURL}`;
        await ctx.context.runInBackgroundOrAwait(
          ctx.context.options.emailVerification.sendVerificationEmail(
            {
              user: createdUser,
              url,
              token,
            },
            ctx.request,
          ),
        );
      }

      if (
        ctx.context.options.emailAndPassword?.requireEmailVerification ||
        ctx.context.options.emailAndPassword?.autoSignIn === false
      ) {
        return ctx.json({
          token: null,
          user: createdUser,
        });
      }

      const session = await ctx.context.internalAdapter.createSession(
        createdUser.id,
        rememberMe === false,
        { tenantId: tenant.id },
      );
      if (!session) {
        throw APIError.from("BAD_REQUEST", TENANT_AUTH_ERROR_CODES.FAILED_TO_CREATE_SESSION);
      }
      await setSessionCookie(ctx, { session, user: createdUser }, rememberMe === false);
      return ctx.json({
        token: session.token,
        user: createdUser,
      });
    },
  );

export const signInEmailTenant = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/sign-in/email",
    {
      method: "POST",
      operationId: "tenantSignInEmail",
      body: z.object({
        tenantId: z
          .string()
          .meta({ description: "The id of the tenant to sign in under" })
          .optional(),
        email: z.string().meta({ description: "The email of the user" }),
        password: z.string().meta({ description: "The password of the user" }),
        callbackURL: z
          .string()
          .meta({ description: "Callback URL to redirect to after sign in" })
          .optional(),
        rememberMe: z
          .boolean()
          .meta({
            description: "If this is false, the session will not be remembered. Default is `true`.",
          })
          .optional(),
      }),
      use: [originCheck((ctx) => ctx.body?.callbackURL)],
      metadata: {
        openapi: {
          operationId: "tenantSignInEmail",
          description: "Sign in a user under a tenant with email and password",
        },
      },
    },
    async (ctx) => {
      if (ctx.context.options.emailAndPassword?.enabled === false) {
        throw APIError.from("BAD_REQUEST", TENANT_AUTH_ERROR_CODES.EMAIL_PASSWORD_NOT_ENABLED);
      }
      assertTrustedRedirectURL(ctx, ctx.body.callbackURL);
      const tenant = await requireTenant(ctx, options);
      const { email, password, rememberMe } = ctx.body;

      const user = await findTenantUserByEmail(ctx, email, tenant.id);
      if (!user) {
        // Hash the password to keep response times consistent between
        // existing and non-existing users.
        await ctx.context.password.hash(password);
        throw APIError.from("UNAUTHORIZED", TENANT_AUTH_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD);
      }
      const credentialAccount = await ctx.context.adapter.findOne<Account>({
        model: "account",
        where: [
          { field: "userId", value: user.id },
          { field: "providerId", value: "credential" },
        ],
      });
      if (!credentialAccount?.password) {
        await ctx.context.password.hash(password);
        throw APIError.from("UNAUTHORIZED", TENANT_AUTH_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD);
      }
      const validPassword = await ctx.context.password.verify({
        hash: credentialAccount.password,
        password,
      });
      if (!validPassword) {
        throw APIError.from("UNAUTHORIZED", TENANT_AUTH_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD);
      }

      if (ctx.context.options.emailAndPassword?.requireEmailVerification && !user.emailVerified) {
        if (
          ctx.context.options.emailVerification?.sendOnSignIn &&
          ctx.context.options.emailVerification?.sendVerificationEmail
        ) {
          const token = await createEmailVerificationToken(
            ctx.context.secret,
            user.email,
            undefined,
            ctx.context.options.emailVerification?.expiresIn,
            { tenantId: tenant.id },
          );
          const callbackURL = encodeURIComponent(ctx.body.callbackURL || "/");
          const url = `${ctx.context.baseURL}/tenant/verify-email?token=${token}&callbackURL=${callbackURL}`;
          await ctx.context.runInBackgroundOrAwait(
            ctx.context.options.emailVerification.sendVerificationEmail(
              {
                user,
                url,
                token,
              },
              ctx.request,
            ),
          );
        }
        throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
      }

      const session = await ctx.context.internalAdapter.createSession(
        user.id,
        rememberMe === false,
        { tenantId: tenant.id },
      );
      if (!session) {
        throw APIError.from("UNAUTHORIZED", TENANT_AUTH_ERROR_CODES.FAILED_TO_CREATE_SESSION);
      }
      await setSessionCookie(ctx, { session, user }, rememberMe === false);

      if (ctx.body.callbackURL) {
        assertTrustedRedirectURL(ctx, ctx.body.callbackURL);
        ctx.setHeader("Location", ctx.body.callbackURL);
      }

      return ctx.json({
        redirect: !!ctx.body.callbackURL,
        token: session.token,
        url: ctx.body.callbackURL,
        user,
      });
    },
  );
