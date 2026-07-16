import { relations, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email"),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    tenantId: text("tenant_id").references((): AnyPgColumn => tenant.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("user_tenantId_idx").on(table.tenantId),
    // Platform users (tenantId null): email unique globally
    uniqueIndex("user_email_platform_unique")
      .on(table.email)
      .where(sql`${table.tenantId} IS NULL`),
    // Tenant users: email unique per tenant
    uniqueIndex("user_email_tenant_unique")
      .on(table.email, table.tenantId)
      .where(sql`${table.tenantId} IS NOT NULL`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenant.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("session_userId_idx").on(table.userId),
    index("session_tenantId_idx").on(table.tenantId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    tenantId: text("tenant_id").references(() => tenant.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    index("account_userId_idx").on(table.userId),
    index("account_tenantId_idx").on(table.tenantId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    tenantId: text("tenant_id"),
  },
  (table) => [
    index("verification_identifier_idx").on(table.identifier),
    index("verification_tenantId_idx").on(table.tenantId),
  ],
);

export const tenant = pgTable(
  "tenant",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    ownerId: text("owner_id").references((): AnyPgColumn => user.id, {
      onDelete: "set null",
    }),
    metadata: text("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("tenant_ownerId_idx").on(table.ownerId)],
);

export const tenantMember = pgTable(
  "tenant_member",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("tenantMember_tenantId_idx").on(table.tenantId),
    index("tenantMember_userId_idx").on(table.userId),
    uniqueIndex("tenant_member_tenant_user_unique").on(table.tenantId, table.userId),
  ],
);

export const tenantOauthConfig = pgTable(
  "tenant_oauth_config",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret").notNull(),
    scopes: text("scopes"),
    redirectURI: text("redirect_uri"),
    enabled: boolean("enabled").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("tenantOauthConfig_tenantId_idx").on(table.tenantId),
    uniqueIndex("tenant_oauth_tenant_provider_unique").on(table.tenantId, table.providerId),
  ],
);

export const tenantInvite = pgTable(
  "tenant_invite",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    token: text("token").notNull().unique(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("tenantInvite_tenantId_idx").on(table.tenantId),
    index("tenantInvite_email_idx").on(table.email),
    index("tenantInvite_invitedBy_idx").on(table.invitedBy),
  ],
);

export const userRelations = relations(user, ({ one, many }) => ({
  tenant: one(tenant, {
    fields: [user.tenantId],
    references: [tenant.id],
  }),
  sessions: many(session),
  accounts: many(account),
  tenantMemberships: many(tenantMember),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
  tenant: one(tenant, {
    fields: [session.tenantId],
    references: [tenant.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
  tenant: one(tenant, {
    fields: [account.tenantId],
    references: [tenant.id],
  }),
}));

export const tenantRelations = relations(tenant, ({ many, one }) => ({
  owner: one(user, {
    fields: [tenant.ownerId],
    references: [user.id],
  }),
  users: many(user),
  sessions: many(session),
  accounts: many(account),
  members: many(tenantMember),
  tenantOauthConfigs: many(tenantOauthConfig),
}));

export const tenantMemberRelations = relations(tenantMember, ({ one }) => ({
  tenant: one(tenant, {
    fields: [tenantMember.tenantId],
    references: [tenant.id],
  }),
  user: one(user, {
    fields: [tenantMember.userId],
    references: [user.id],
  }),
}));

export const tenantOauthConfigRelations = relations(tenantOauthConfig, ({ one }) => ({
  tenant: one(tenant, {
    fields: [tenantOauthConfig.tenantId],
    references: [tenant.id],
  }),
}));
