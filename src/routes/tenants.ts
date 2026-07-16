import { APIError, createAuthEndpoint } from "better-auth/api";
import * as z from "zod";
import { TENANT_AUTH_ERROR_CODES } from "./../error-codes";
import type { Tenant, TenantAuthOptions } from "./../types";
import {
  assertCanManageTenant,
  assertValidSlug,
  canViewTenantDetails,
  createTenantWithOwner,
  listAccessibleTenantIds,
  listWithPagination,
  MAX_LIST_LIMIT,
  resolveManagementAccess,
  toPublicTenant,
} from "./../utils";

export const createTenant = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/create",
    {
      method: "POST",
      operationId: "createTenant",
      body: z.object({
        name: z.string().meta({
          description: "Display name of the tenant",
        }),
        slug: z.string().meta({
          description: "Unique, URL-friendly identifier for the tenant",
        }),
        metadata: z
          .record(z.string(), z.any())
          .meta({
            description: "Arbitrary metadata stored with the tenant",
          })
          .optional(),
      }),
      metadata: {
        openapi: {
          operationId: "createTenant",
          description: "Create a new tenant",
        },
      },
    },
    async (ctx) => {
      const access = await resolveManagementAccess(ctx, options);
      assertValidSlug(ctx.body.slug, options);
      const existing = await ctx.context.adapter.findOne<Tenant>({
        model: "tenant",
        where: [{ field: "slug", value: ctx.body.slug }],
      });
      if (existing) {
        throw APIError.from("UNPROCESSABLE_ENTITY", TENANT_AUTH_ERROR_CODES.TENANT_ALREADY_EXISTS);
      }
      const tenant = await createTenantWithOwner(
        ctx,
        {
          name: ctx.body.name,
          slug: ctx.body.slug,
          ownerId: access.userId,
          metadata: ctx.body.metadata ? JSON.stringify(ctx.body.metadata) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        access.userId,
      );
      return ctx.json(tenant);
    },
  );

export const getTenant = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/get",
    {
      method: "GET",
      operationId: "getTenant",
      query: z.object({
        id: z.string().meta({ description: "The id of the tenant" }).optional(),
        slug: z.string().meta({ description: "The slug of the tenant" }).optional(),
      }),
      metadata: {
        openapi: {
          operationId: "getTenant",
          description:
            "Get a tenant by id or slug. Unauthorized callers receive only the public fields (id, name, slug, createdAt)",
        },
      },
    },
    async (ctx) => {
      const { id, slug } = ctx.query;
      if (!id && !slug) {
        throw APIError.from("BAD_REQUEST", TENANT_AUTH_ERROR_CODES.TENANT_ID_REQUIRED);
      }
      const tenant = await ctx.context.adapter.findOne<Tenant>({
        model: "tenant",
        where: id ? [{ field: "id", value: id }] : [{ field: "slug", value: slug! }],
      });
      if (!tenant) {
        throw APIError.from("NOT_FOUND", TENANT_AUTH_ERROR_CODES.TENANT_NOT_FOUND);
      }
      if (
        options?.exposeTenantDetailsPublicly ||
        (await canViewTenantDetails(ctx, tenant, options))
      ) {
        return ctx.json(tenant);
      }
      return ctx.json(toPublicTenant(tenant));
    },
  );

export const listTenants = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/list",
    {
      method: "GET",
      operationId: "listTenants",
      query: z
        .object({
          limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(MAX_LIST_LIMIT)
            .meta({ description: "Maximum number of tenants to return" })
            .optional(),
          offset: z.coerce
            .number()
            .int()
            .min(0)
            .meta({ description: "Number of tenants to skip" })
            .optional(),
        })
        .default({}),
      metadata: {
        openapi: {
          operationId: "listTenants",
          description: "List tenants the caller can access",
        },
      },
    },
    async (ctx) => {
      const access = await resolveManagementAccess(ctx, options);
      const sortBy = { field: "createdAt", direction: "desc" as const };
      const pagination = { limit: ctx.query.limit, offset: ctx.query.offset };

      if (access.kind === "global") {
        return ctx.json(
          await listWithPagination<Tenant>(ctx, {
            model: "tenant",
            sortBy,
            ...pagination,
          }),
        );
      }

      const tenantIds = await listAccessibleTenantIds(ctx, access.userId);
      if (tenantIds.length === 0) {
        if (pagination.limit !== undefined || (pagination.offset ?? 0) > 0) {
          return ctx.json({ data: [], total: 0 });
        }
        return ctx.json([]);
      }

      return ctx.json(
        await listWithPagination<Tenant>(ctx, {
          model: "tenant",
          where: [{ field: "id", value: tenantIds, operator: "in" }],
          sortBy,
          ...pagination,
        }),
      );
    },
  );

export const updateTenant = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/update",
    {
      method: "POST",
      operationId: "updateTenant",
      body: z.object({
        id: z.string().meta({ description: "The id of the tenant" }),
        data: z.object({
          name: z.string().optional(),
          slug: z.string().optional(),
          metadata: z.record(z.string(), z.any()).nullable().optional().meta({
            description: "Arbitrary metadata stored with the tenant. Pass `null` to clear.",
          }),
        }),
      }),
      metadata: {
        openapi: {
          operationId: "updateTenant",
          description: "Update a tenant",
        },
      },
    },
    async (ctx) => {
      const access = await resolveManagementAccess(ctx, options);
      const tenant = await ctx.context.adapter.findOne<Tenant>({
        model: "tenant",
        where: [{ field: "id", value: ctx.body.id }],
      });
      if (!tenant) {
        throw APIError.from("NOT_FOUND", TENANT_AUTH_ERROR_CODES.TENANT_NOT_FOUND);
      }
      await assertCanManageTenant(ctx, access, tenant, "admin");
      if (ctx.body.data.slug && ctx.body.data.slug !== tenant.slug) {
        assertValidSlug(ctx.body.data.slug, options);
        const existing = await ctx.context.adapter.findOne<Tenant>({
          model: "tenant",
          where: [{ field: "slug", value: ctx.body.data.slug }],
        });
        if (existing) {
          throw APIError.from(
            "UNPROCESSABLE_ENTITY",
            TENANT_AUTH_ERROR_CODES.TENANT_ALREADY_EXISTS,
          );
        }
      }
      const updated = await ctx.context.adapter.update<Tenant>({
        model: "tenant",
        where: [{ field: "id", value: ctx.body.id }],
        update: {
          ...(ctx.body.data.name ? { name: ctx.body.data.name } : {}),
          ...(ctx.body.data.slug ? { slug: ctx.body.data.slug } : {}),
          ...("metadata" in ctx.body.data
            ? {
                metadata:
                  ctx.body.data.metadata === null ? null : JSON.stringify(ctx.body.data.metadata),
              }
            : {}),
          updatedAt: new Date(),
        },
      });
      return ctx.json(updated ?? tenant);
    },
  );

export const deleteTenant = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/delete",
    {
      method: "POST",
      operationId: "deleteTenant",
      body: z.object({
        id: z.string().meta({ description: "The id of the tenant" }),
      }),
      metadata: {
        openapi: {
          operationId: "deleteTenant",
          description: "Delete a tenant",
        },
      },
    },
    async (ctx) => {
      const access = await resolveManagementAccess(ctx, options);
      const tenant = await ctx.context.adapter.findOne<Tenant>({
        model: "tenant",
        where: [{ field: "id", value: ctx.body.id }],
      });
      if (!tenant) {
        throw APIError.from("NOT_FOUND", TENANT_AUTH_ERROR_CODES.TENANT_NOT_FOUND);
      }
      await assertCanManageTenant(ctx, access, tenant, "owner");
      await ctx.context.adapter.delete({
        model: "tenant",
        where: [{ field: "id", value: ctx.body.id }],
      });
      return ctx.json({ success: true });
    },
  );
