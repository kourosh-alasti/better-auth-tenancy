import { BASE_ERROR_CODES } from "@better-auth/core/error";
import type { User } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  originCheck,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { jwtVerify } from "jose";
import { JWTExpired } from "jose/errors";
import * as z from "zod";
import { TENANT_AUTH_ERROR_CODES } from "./../error-codes";
import type { TenantAuthOptions } from "./../types";

type TenantUser = User & { tenantId?: string | null };

/**
 * Payload shape written by `createEmailVerificationToken(secret, email, ...,
 * { tenantId })` in `src/routes/email.ts`. A missing `tenantId` means the
 * token was issued by core (`/send-verification-email`) and belongs to the
 * core `/verify-email` flow, not this endpoint.
 */
const tenantVerificationPayloadSchema = z.object({
  email: z.email(),
  tenantId: z.string().nonempty(),
});

async function verifyTenantToken(secret: string, token: string) {
  return await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
  });
}

export const verifyEmailTenant = (_options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/verify-email",
    {
      method: "GET",
      operationId: "tenantVerifyEmail",
      query: z.object({
        token: z.string().meta({ description: "The tenant email verification token" }),
        callbackURL: z
          .string()
          .meta({ description: "The URL to redirect to after email verification" })
          .optional(),
      }),
      use: [originCheck((ctx) => ctx.query.callbackURL)],
      metadata: {
        openapi: {
          operationId: "tenantVerifyEmail",
          description: "Verify the email of a tenant-scoped user",
        },
      },
    },
    async (ctx) => {
      const { token, callbackURL } = ctx.query;

      function redirectOnError(error: { code: string; message: string }): never {
        if (callbackURL) {
          const separator = callbackURL.includes("?") ? "&" : "?";
          throw ctx.redirect(`${callbackURL}${separator}error=${error.code}`);
        }
        throw APIError.from("UNAUTHORIZED", error);
      }

      let payload: unknown;
      try {
        payload = (await verifyTenantToken(ctx.context.secret, token)).payload;
      } catch (error) {
        if (error instanceof JWTExpired) {
          return redirectOnError(BASE_ERROR_CODES.TOKEN_EXPIRED);
        }
        return redirectOnError(BASE_ERROR_CODES.INVALID_TOKEN);
      }

      const parsed = tenantVerificationPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        // Missing `tenantId` (or malformed payload) — this is a core
        // verification token, not one of ours.
        return redirectOnError(TENANT_AUTH_ERROR_CODES.INVALID_VERIFICATION_TOKEN);
      }
      const { email, tenantId } = parsed.data;

      const user = await ctx.context.adapter.findOne<TenantUser>({
        model: "user",
        where: [
          { field: "email", value: email.toLowerCase() },
          { field: "tenantId", value: tenantId },
        ],
      });
      if (!user) {
        return redirectOnError(BASE_ERROR_CODES.USER_NOT_FOUND);
      }

      if (user.emailVerified) {
        if (callbackURL) throw ctx.redirect(callbackURL);
        return ctx.json({ status: true, user: null });
      }

      if (ctx.context.options.emailVerification?.beforeEmailVerification) {
        await ctx.context.options.emailVerification.beforeEmailVerification(user, ctx.request);
      }

      const updatedUser = (await ctx.context.internalAdapter.updateUser(user.id, {
        emailVerified: true,
      })) as TenantUser;

      if (ctx.context.options.emailVerification?.afterEmailVerification) {
        await ctx.context.options.emailVerification.afterEmailVerification(
          updatedUser,
          ctx.request,
        );
      }

      if (ctx.context.options.emailVerification?.autoSignInAfterVerification) {
        const currentSession = await getSessionFromCtx(ctx);
        if (!currentSession || currentSession.user.email !== user.email) {
          const session = await ctx.context.internalAdapter.createSession(user.id, undefined, {
            tenantId,
          });
          if (!session) {
            throw APIError.from(
              "INTERNAL_SERVER_ERROR",
              TENANT_AUTH_ERROR_CODES.FAILED_TO_CREATE_SESSION,
            );
          }
          await setSessionCookie(ctx, {
            session,
            user: { ...user, emailVerified: true },
          });
        } else {
          await setSessionCookie(ctx, {
            session: currentSession.session,
            user: { ...currentSession.user, emailVerified: true },
          });
        }
      }

      if (callbackURL) throw ctx.redirect(callbackURL);
      return ctx.json({ status: true, user: null });
    },
  );

/**
 * Plugin `hooks.before` handler for core's `/verify-email`. Tenant sign-up /
 * sign-in issue verification tokens with a `tenantId` claim (see
 * `src/routes/email.ts`) that must only ever be redeemed through
 * `/tenant/verify-email`, since core's endpoint resolves the user by email
 * alone and would verify the wrong user for a shared email across tenants.
 */
export const rejectTenantTokenOnCoreVerifyEmail = () =>
  createAuthMiddleware(async (ctx) => {
    const token = (ctx.query as { token?: string } | undefined)?.token;
    if (!token) return;

    let payload: unknown;
    try {
      payload = (await verifyTenantToken(ctx.context.secret, token)).payload;
    } catch {
      // Malformed / expired tokens are core's own problem to report.
      return;
    }

    const tenantId =
      payload && typeof payload === "object" && "tenantId" in payload
        ? (payload as { tenantId?: unknown }).tenantId
        : undefined;
    if (!tenantId) return;

    const callbackURL = (ctx.query as { callbackURL?: string } | undefined)?.callbackURL;
    if (callbackURL) {
      const separator = callbackURL.includes("?") ? "&" : "?";
      throw ctx.redirect(
        `${callbackURL}${separator}error=${TENANT_AUTH_ERROR_CODES.INVALID_VERIFICATION_TOKEN.code}`,
      );
    }
    throw APIError.from("BAD_REQUEST", TENANT_AUTH_ERROR_CODES.INVALID_VERIFICATION_TOKEN);
  });
