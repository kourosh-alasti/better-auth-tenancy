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
        // Per-tenant uniqueness (and presence) is enforced by the
        // plugin's endpoints. `required` must stay `false` here so the
        // field isn't treated as a required additional input field by
        // the core sign-up flow.
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
        tenantId: {
          type: "string",
          required: false,
          input: false,
          index: true,
        },
      },
    },
  } satisfies BetterAuthPluginDBSchema;
};
