import type { GenericEndpointContext } from "@better-auth/core";
import type { User } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import * as z from "zod";
import { TENANT_AUTH_ERROR_CODES } from "./../error-codes";
import type { Tenant, TenantAuthOptions, TenantMember, TenantRole } from "./../types";
import {
  assertCanManageTenant,
  assertNotLastOwner,
  findTenantMember,
  isTenantRole,
  listWithPagination,
  MAX_LIST_LIMIT,
  resolveManagementAccess,
  resolveTenantRole,
  roleAtLeast,
  syncTenantOwnerId,
} from "./../utils";

const roleSchema = z.enum(["owner", "admin", "member"]);

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

async function findPlatformUser(
  ctx: GenericEndpointContext,
  opts: { userId?: string; email?: string },
): Promise<User & { tenantId?: string | null }> {
  let user: (User & { tenantId?: string | null }) | null = null;

  if (opts.userId) {
    user = await ctx.context.adapter.findOne<User & { tenantId?: string | null }>({
      model: "user",
      where: [{ field: "id", value: opts.userId }],
    });
  } else if (opts.email) {
    const email = opts.email.toLowerCase();
    const platformUsers = await ctx.context.adapter.findMany<User & { tenantId?: string | null }>({
      model: "user",
      where: [
        { field: "email", value: email },
        { field: "tenantId", value: null },
      ],
    });
    if (platformUsers.length > 1) {
      throw APIError.from("UNPROCESSABLE_ENTITY", TENANT_AUTH_ERROR_CODES.PLATFORM_USER_AMBIGUOUS);
    }
    user = platformUsers[0] ?? null;
  }

  if (!user || user.tenantId) {
    throw APIError.from("NOT_FOUND", TENANT_AUTH_ERROR_CODES.PLATFORM_USER_NOT_FOUND);
  }
  return user;
}

export const addTenantMember = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/member/add",
    {
      method: "POST",
      operationId: "addTenantMember",
      body: z.object({
        tenantId: z.string().meta({ description: "The id of the tenant" }),
        userId: z.string().meta({ description: "Platform user id to add as a member" }).optional(),
        email: z.email().meta({ description: "Platform user email to add as a member" }).optional(),
        role: roleSchema.meta({ description: "Role to assign (default: member)" }).optional(),
      }),
      metadata: {
        openapi: {
          operationId: "addTenantMember",
          description: "Add a platform user as a member of a tenant",
        },
      },
    },
    async (ctx) => {
      if (!ctx.body.userId && !ctx.body.email) {
        throw APIError.from("BAD_REQUEST", TENANT_AUTH_ERROR_CODES.PLATFORM_USER_REQUIRED);
      }

      const access = await resolveManagementAccess(ctx, options);
      const tenant = await requireTenantById(ctx, ctx.body.tenantId);
      await assertCanManageTenant(ctx, access, tenant, "admin");

      const role: TenantRole = ctx.body.role ?? "member";
      if (access.kind === "user") {
        const actorRole = await resolveTenantRole(ctx, tenant, access.userId);
        if (actorRole === "admin" && role !== "member") {
          throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.TENANT_MANAGEMENT_NOT_ALLOWED);
        }
      }

      const target = await findPlatformUser(ctx, {
        userId: ctx.body.userId,
        email: ctx.body.email,
      });

      const existing = await findTenantMember(ctx, tenant.id, target.id);
      if (existing) {
        throw APIError.from("UNPROCESSABLE_ENTITY", TENANT_AUTH_ERROR_CODES.MEMBER_ALREADY_EXISTS);
      }

      const member = await ctx.context.adapter.create<Omit<TenantMember, "id">, TenantMember>({
        model: "tenantMember",
        data: {
          tenantId: tenant.id,
          userId: target.id,
          role,
          createdAt: new Date(),
        },
      });

      if (role === "owner") {
        await syncTenantOwnerId(ctx, tenant.id);
      }

      return ctx.json(member);
    },
  );

export const listTenantMembers = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/member/list",
    {
      method: "GET",
      operationId: "listTenantMembers",
      query: z.object({
        tenantId: z.string().meta({ description: "The id of the tenant" }),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(MAX_LIST_LIMIT)
          .meta({ description: "Maximum number of members to return" })
          .optional(),
        offset: z.coerce
          .number()
          .int()
          .min(0)
          .meta({ description: "Number of members to skip" })
          .optional(),
      }),
      metadata: {
        openapi: {
          operationId: "listTenantMembers",
          description: "List members of a tenant",
        },
      },
    },
    async (ctx) => {
      const access = await resolveManagementAccess(ctx, options);
      const tenant = await requireTenantById(ctx, ctx.query.tenantId);
      await assertCanManageTenant(ctx, access, tenant, "member");
      return ctx.json(
        await listWithPagination<TenantMember>(ctx, {
          model: "tenantMember",
          where: [{ field: "tenantId", value: tenant.id }],
          sortBy: { field: "createdAt", direction: "asc" },
          limit: ctx.query.limit,
          offset: ctx.query.offset,
        }),
      );
    },
  );

export const updateTenantMember = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/member/update",
    {
      method: "POST",
      operationId: "updateTenantMember",
      body: z.object({
        tenantId: z.string().meta({ description: "The id of the tenant" }),
        userId: z.string().meta({ description: "Member user id" }),
        role: roleSchema.meta({ description: "New role" }),
      }),
      metadata: {
        openapi: {
          operationId: "updateTenantMember",
          description: "Update a tenant member's role",
        },
      },
    },
    async (ctx) => {
      const access = await resolveManagementAccess(ctx, options);
      const tenant = await requireTenantById(ctx, ctx.body.tenantId);
      await assertCanManageTenant(ctx, access, tenant, "owner");

      const member = await findTenantMember(ctx, tenant.id, ctx.body.userId);
      if (!member || !isTenantRole(member.role)) {
        throw APIError.from("NOT_FOUND", TENANT_AUTH_ERROR_CODES.MEMBER_NOT_FOUND);
      }

      if (member.role === "owner" && ctx.body.role !== "owner") {
        await assertNotLastOwner(ctx, tenant.id);
      }

      const updated = await ctx.context.adapter.update<TenantMember>({
        model: "tenantMember",
        where: [{ field: "id", value: member.id }],
        update: { role: ctx.body.role },
      });

      if (member.role === "owner" || ctx.body.role === "owner") {
        await syncTenantOwnerId(ctx, tenant.id);
      }

      return ctx.json(updated ?? { ...member, role: ctx.body.role });
    },
  );

export const removeTenantMember = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/member/remove",
    {
      method: "POST",
      operationId: "removeTenantMember",
      body: z.object({
        tenantId: z.string().meta({ description: "The id of the tenant" }),
        userId: z.string().meta({ description: "Member user id to remove" }),
      }),
      metadata: {
        openapi: {
          operationId: "removeTenantMember",
          description: "Remove a member from a tenant",
        },
      },
    },
    async (ctx) => {
      const access = await resolveManagementAccess(ctx, options);
      const tenant = await requireTenantById(ctx, ctx.body.tenantId);
      await assertCanManageTenant(ctx, access, tenant, "admin");

      const member = await findTenantMember(ctx, tenant.id, ctx.body.userId);
      if (!member || !isTenantRole(member.role)) {
        throw APIError.from("NOT_FOUND", TENANT_AUTH_ERROR_CODES.MEMBER_NOT_FOUND);
      }

      if (access.kind === "user") {
        const actorRole = await resolveTenantRole(ctx, tenant, access.userId);
        if (actorRole === "admin" && roleAtLeast(member.role, "admin")) {
          throw APIError.from("FORBIDDEN", TENANT_AUTH_ERROR_CODES.TENANT_MANAGEMENT_NOT_ALLOWED);
        }
      }

      if (member.role === "owner") {
        await assertNotLastOwner(ctx, tenant.id);
      }

      await ctx.context.adapter.delete({
        model: "tenantMember",
        where: [{ field: "id", value: member.id }],
      });

      if (member.role === "owner") {
        await syncTenantOwnerId(ctx, tenant.id);
      }

      return ctx.json({ success: true });
    },
  );
