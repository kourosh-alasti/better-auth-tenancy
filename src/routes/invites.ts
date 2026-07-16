import { randomBytes } from "node:crypto";
import type { GenericEndpointContext } from "@better-auth/core";
import { APIError, createAuthEndpoint } from "better-auth/api";
import * as z from "zod";
import { TENANT_AUTH_ERROR_CODES } from "./../error-codes";
import type { Tenant, TenantAuthOptions, TenantInvite } from "./../types";
import { assertCanManageTenant, isPendingTenantInvite, resolveManagementAccess } from "./../utils";

const DEFAULT_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

async function requireTenantById(ctx: GenericEndpointContext, id: string) {
  const tenant = await ctx.context.adapter.findOne<Tenant>({
    model: "tenant",
    where: [{ field: "id", value: id }],
  });
  if (!tenant) {
    throw APIError.from("NOT_FOUND", TENANT_AUTH_ERROR_CODES.TENANT_NOT_FOUND);
  }
  return tenant;
}

function resolveInviterId(
  access: Awaited<ReturnType<typeof resolveManagementAccess>>,
  tenant: Tenant,
): string | null {
  if (access.kind === "user") {
    return access.userId;
  }
  if (access.userId) {
    return access.userId;
  }
  return tenant.ownerId ?? null;
}

function toPublicInvite(invite: TenantInvite) {
  return {
    id: invite.id,
    tenantId: invite.tenantId,
    email: invite.email,
    token: invite.token,
    invitedBy: invite.invitedBy,
    expiresAt: invite.expiresAt,
    consumedAt: invite.consumedAt ?? null,
    revokedAt: invite.revokedAt ?? null,
    createdAt: invite.createdAt,
  };
}

export const createTenantInvite = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/invite/create",
    {
      method: "POST",
      operationId: "createTenantInvite",
      body: z.object({
        tenantId: z.string().meta({ description: "The id of the tenant" }),
        email: z.email().meta({ description: "Email address to invite" }),
        expiresIn: z
          .number()
          .int()
          .positive()
          .meta({ description: "Invite lifetime in seconds (default: 7 days)" })
          .optional(),
      }),
      metadata: {
        openapi: {
          operationId: "createTenantInvite",
          description: "Create an invite for a tenant end-user to sign up",
        },
      },
    },
    async (ctx) => {
      const access = await resolveManagementAccess(ctx, options);
      const tenant = await requireTenantById(ctx, ctx.body.tenantId);
      await assertCanManageTenant(ctx, access, tenant, "admin");

      const invitedBy = resolveInviterId(access, tenant);
      const normalizedEmail = ctx.body.email.toLowerCase();
      const expiresIn = ctx.body.expiresIn ?? DEFAULT_INVITE_TTL_SECONDS;
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      const existingInvites = await ctx.context.adapter.findMany<TenantInvite>({
        model: "tenantInvite",
        where: [
          { field: "tenantId", value: tenant.id },
          { field: "email", value: normalizedEmail },
        ],
      });
      if (existingInvites.some(isPendingTenantInvite)) {
        throw APIError.from("UNPROCESSABLE_ENTITY", TENANT_AUTH_ERROR_CODES.INVITE_ALREADY_EXISTS);
      }

      const invite = await ctx.context.adapter.create<Omit<TenantInvite, "id">, TenantInvite>({
        model: "tenantInvite",
        data: {
          tenantId: tenant.id,
          email: normalizedEmail,
          token: generateInviteToken(),
          ...(invitedBy ? { invitedBy } : {}),
          expiresAt,
          createdAt: new Date(),
        },
      });

      return ctx.json(toPublicInvite(invite));
    },
  );

export const listTenantInvites = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/invite/list",
    {
      method: "GET",
      operationId: "listTenantInvites",
      query: z.object({
        tenantId: z.string().meta({ description: "The id of the tenant" }),
        includeConsumed: z
          .boolean()
          .meta({ description: "Include consumed and revoked invites" })
          .optional(),
      }),
      metadata: {
        openapi: {
          operationId: "listTenantInvites",
          description: "List invites for a tenant",
        },
      },
    },
    async (ctx) => {
      const access = await resolveManagementAccess(ctx, options);
      const tenant = await requireTenantById(ctx, ctx.query.tenantId);
      await assertCanManageTenant(ctx, access, tenant, "admin");

      const invites = await ctx.context.adapter.findMany<TenantInvite>({
        model: "tenantInvite",
        where: [{ field: "tenantId", value: tenant.id }],
      });

      const filtered = ctx.query.includeConsumed ? invites : invites.filter(isPendingTenantInvite);

      return ctx.json(filtered.map(toPublicInvite));
    },
  );

export const revokeTenantInvite = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/invite/revoke",
    {
      method: "POST",
      operationId: "revokeTenantInvite",
      body: z.object({
        tenantId: z.string().meta({ description: "The id of the tenant" }),
        inviteId: z.string().meta({ description: "Invite id to revoke" }),
      }),
      metadata: {
        openapi: {
          operationId: "revokeTenantInvite",
          description: "Revoke a pending tenant invite",
        },
      },
    },
    async (ctx) => {
      const access = await resolveManagementAccess(ctx, options);
      const tenant = await requireTenantById(ctx, ctx.body.tenantId);
      await assertCanManageTenant(ctx, access, tenant, "admin");

      const invite = await ctx.context.adapter.findOne<TenantInvite>({
        model: "tenantInvite",
        where: [
          { field: "id", value: ctx.body.inviteId },
          { field: "tenantId", value: tenant.id },
        ],
      });
      if (!invite) {
        throw APIError.from("NOT_FOUND", TENANT_AUTH_ERROR_CODES.INVITE_NOT_FOUND);
      }
      if (invite.consumedAt) {
        throw APIError.from("UNPROCESSABLE_ENTITY", TENANT_AUTH_ERROR_CODES.INVITE_INVALID);
      }
      if (invite.revokedAt) {
        return ctx.json(toPublicInvite(invite));
      }

      const revoked = await ctx.context.adapter.update<TenantInvite>({
        model: "tenantInvite",
        where: [{ field: "id", value: invite.id }],
        update: { revokedAt: new Date() },
      });

      return ctx.json(toPublicInvite(revoked ?? { ...invite, revokedAt: new Date() }));
    },
  );
