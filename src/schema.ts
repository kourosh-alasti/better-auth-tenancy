import type { BetterAuthPluginDBSchema, DBFieldAttribute } from "better-auth";
import type { TenantAuthOptions } from "./types.ts";

const tenantIdReference = (options?: TenantAuthOptions): DBFieldAttribute => ({
  type: "string",
  required: false,
  input: false,
  index: true,
  references: {
    model: options?.schema?.tenant?.modelName || "tenant",
    field: "id",
    onDelete: "cascade",
  },
});

/**
 * Plugin schema for multi-tenancy.
 *
 * Better Auth's schema DSL does not generate composite unique indexes.
 * Applications must add these in their ORM / migrations (see docs):
 * - `user`: unique (email) where tenantId is null; unique (email, tenantId) where tenantId is not null
 * - `tenantOauthConfig`: unique (tenantId, providerId)
 * - `tenantMember`: unique (tenantId, userId)
 */
export const getSchema = (options?: TenantAuthOptions) => {
  return {
    tenant: {
      fields: {
        name: {
          type: "string",
          required: true,
          sortable: true,
        },
        slug: {
          type: "string",
          required: true,
          unique: true,
          sortable: true,
        },
        ownerId: {
          type: "string",
          required: false,
          index: true,
          input: false,
          references: {
            model: "user",
            field: "id",
            onDelete: "set null",
          },
        },
        metadata: {
          type: "string",
          required: false,
        },
        createdAt: {
          type: "date",
          required: true,
          defaultValue: () => new Date(),
        },
        updatedAt: {
          type: "date",
          required: true,
          defaultValue: () => new Date(),
          onUpdate: () => new Date(),
        },
      },
    },
    tenantMember: {
      fields: {
        tenantId: {
          type: "string",
          required: true,
          index: true,
          references: {
            model: options?.schema?.tenant?.modelName || "tenant",
            field: "id",
            onDelete: "cascade",
          },
        },
        userId: {
          type: "string",
          required: true,
          index: true,
          references: {
            model: "user",
            field: "id",
            onDelete: "cascade",
          },
        },
        role: {
          type: "string",
          required: true,
          defaultValue: "member",
        },
        createdAt: {
          type: "date",
          required: true,
          defaultValue: () => new Date(),
        },
      },
    },
    tenantInvite: {
      fields: {
        tenantId: {
          type: "string",
          required: true,
          index: true,
          references: {
            model: options?.schema?.tenant?.modelName || "tenant",
            field: "id",
            onDelete: "cascade",
          },
        },
        email: {
          type: "string",
          required: true,
          index: true,
        },
        token: {
          type: "string",
          required: true,
          unique: true,
        },
        invitedBy: {
          type: "string",
          required: false,
          index: true,
          references: {
            model: "user",
            field: "id",
            onDelete: "set null",
          },
        },
        expiresAt: {
          type: "date",
          required: true,
        },
        consumedAt: {
          type: "date",
          required: false,
        },
        revokedAt: {
          type: "date",
          required: false,
        },
        createdAt: {
          type: "date",
          required: true,
          defaultValue: () => new Date(),
        },
      },
    },
    tenantOauthConfig: {
      fields: {
        tenantId: {
          type: "string",
          required: true,
          index: true,
          references: {
            model: options?.schema?.tenant?.modelName || "tenant",
            field: "id",
            onDelete: "cascade",
          },
        },
        providerId: {
          type: "string",
          required: true,
          index: true,
        },
        clientId: {
          type: "string",
          required: true,
        },
        clientSecret: {
          type: "string",
          required: true,
          returned: false,
        },
        scopes: {
          type: "string",
          required: false,
        },
        redirectURI: {
          type: "string",
          required: false,
        },
        enabled: {
          type: "boolean",
          required: false,
          defaultValue: true,
        },
        createdAt: {
          type: "date",
          required: true,
          defaultValue: () => new Date(),
        },
        updatedAt: {
          type: "date",
          required: true,
          defaultValue: () => new Date(),
          onUpdate: () => new Date(),
        },
      },
    },
    user: {
      fields: {
        tenantId: tenantIdReference(options),
        // Drop the global unique constraint on `user.email` so the same
        // email can exist as separate users under different tenants.
        // Per-tenant / platform uniqueness must be enforced with composite
        // or partial unique indexes in the app schema (see docs).
        // `required` must stay `false` here so the field isn't treated as
        // a required additional input field by the core sign-up flow.
        ...(options?.keepEmailGloballyUnique
          ? {}
          : {
              email: {
                type: "string",
                unique: false,
                required: false,
                sortable: true,
              } satisfies DBFieldAttribute,
            }),
      },
    },
    session: {
      fields: {
        tenantId: tenantIdReference(options),
      },
    },
    account: {
      fields: {
        tenantId: tenantIdReference(options),
      },
    },
    verification: {
      fields: {
        // Not written to when a token is issued for the tenant sign-up /
        // sign-in flow: those tokens are JWTs (see `createEmailVerificationToken`)
        // carrying a `tenantId` claim, verified by `/tenant/verify-email`
        // without ever touching the `verification` table. This column
        // stays available for adapters that persist verification rows
        // through other flows (e.g. a custom `sendVerificationEmail`).
        tenantId: tenantIdReference(options),
      },
    },
  } satisfies BetterAuthPluginDBSchema;
};
