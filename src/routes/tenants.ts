import { APIError, createAuthEndpoint } from "better-auth/api";
import * as z from "zod";
import { TENANT_AUTH_ERROR_CODES } from "./../error-codes";
import type { Tenant, TenantAuthOptions } from "./../types";
import { requireManagementAccess } from "./../utils";

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
      await requireManagementAccess(ctx, options);
      const existing = await ctx.context.adapter.findOne<Tenant>({
        model: "tenant",
        where: [{ field: "slug", value: ctx.body.slug }],
      });
      if (existing) {
        throw APIError.from("UNPROCESSABLE_ENTITY", TENANT_AUTH_ERROR_CODES.TENANT_ALREADY_EXISTS);
      }
      const tenant = await ctx.context.adapter.create<Omit<Tenant, "id">, Tenant>({
        model: "tenant",
        data: {
          name: ctx.body.name,
          slug: ctx.body.slug,
          metadata: ctx.body.metadata ? JSON.stringify(ctx.body.metadata) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return ctx.json(tenant);
    },
  );

export const getTenant = () =>
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
          description: "Get a tenant by id or slug",
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
      return ctx.json(tenant);
    },
  );

export const listTenants = (options?: TenantAuthOptions) =>
  createAuthEndpoint(
    "/tenant/list",
    {
      method: "GET",
      operationId: "listTenants",
      metadata: {
        openapi: {
          operationId: "listTenants",
          description: "List all tenants",
        },
      },
    },
    async (ctx) => {
      await requireManagementAccess(ctx, options);
      const tenants = await ctx.context.adapter.findMany<Tenant>({
        model: "tenant",
      });
      return ctx.json(tenants);
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
          metadata: z.record(z.string(), z.any()).optional(),
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
      await requireManagementAccess(ctx, options);
      const tenant = await ctx.context.adapter.findOne<Tenant>({
        model: "tenant",
        where: [{ field: "id", value: ctx.body.id }],
      });
      if (!tenant) {
        throw APIError.from("NOT_FOUND", TENANT_AUTH_ERROR_CODES.TENANT_NOT_FOUND);
      }
      if (ctx.body.data.slug && ctx.body.data.slug !== tenant.slug) {
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
          ...(ctx.body.data.metadata ? { metadata: JSON.stringify(ctx.body.data.metadata) } : {}),
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
      await requireManagementAccess(ctx, options);
      const tenant = await ctx.context.adapter.findOne<Tenant>({
        model: "tenant",
        where: [{ field: "id", value: ctx.body.id }],
      });
      if (!tenant) {
        throw APIError.from("NOT_FOUND", TENANT_AUTH_ERROR_CODES.TENANT_NOT_FOUND);
      }
      await ctx.context.adapter.delete({
        model: "tenant",
        where: [{ field: "id", value: ctx.body.id }],
      });
      return ctx.json({ success: true });
    },
  );
