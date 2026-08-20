-- Production-shaped schema for Postgres integration tests.
-- Mirrors examples/nextjs-demo + tenant_invite, including composite uniques.

CREATE TABLE "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text,
  "email_verified" boolean DEFAULT false NOT NULL,
  "image" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "tenant_id" text
);

CREATE TABLE "tenant" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "owner_id" text,
  "metadata" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "user"
  ADD CONSTRAINT "user_tenant_id_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE cascade;

ALTER TABLE "tenant"
  ADD CONSTRAINT "tenant_owner_id_user_id_fk"
  FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE set null;

CREATE TABLE "session" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp NOT NULL,
  "token" text NOT NULL UNIQUE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "tenant_id" text REFERENCES "tenant"("id") ON DELETE cascade
);

CREATE TABLE "account" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp,
  "refresh_token_expires_at" timestamp,
  "scope" text,
  "password" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp NOT NULL,
  "tenant_id" text REFERENCES "tenant"("id") ON DELETE cascade
);

CREATE TABLE "verification" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "tenant_id" text
);

CREATE TABLE "tenant_member" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenant"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "role" text DEFAULT 'member' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "tenant_oauth_config" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenant"("id") ON DELETE cascade,
  "provider_id" text NOT NULL,
  "client_id" text NOT NULL,
  "client_secret" text NOT NULL,
  "scopes" text,
  "redirect_uri" text,
  "enabled" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "tenant_invite" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenant"("id") ON DELETE cascade,
  "email" text NOT NULL,
  "token" text NOT NULL UNIQUE,
  "invited_by" text REFERENCES "user"("id") ON DELETE set null,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "user_tenantId_idx" ON "user" ("tenant_id");
CREATE UNIQUE INDEX "user_email_platform_unique" ON "user" ("email") WHERE "tenant_id" IS NULL;
CREATE UNIQUE INDEX "user_email_tenant_unique" ON "user" ("email", "tenant_id") WHERE "tenant_id" IS NOT NULL;

CREATE INDEX "session_userId_idx" ON "session" ("user_id");
CREATE INDEX "session_tenantId_idx" ON "session" ("tenant_id");

CREATE INDEX "account_userId_idx" ON "account" ("user_id");
CREATE INDEX "account_tenantId_idx" ON "account" ("tenant_id");

CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
CREATE INDEX "verification_tenantId_idx" ON "verification" ("tenant_id");

CREATE INDEX "tenant_ownerId_idx" ON "tenant" ("owner_id");

CREATE INDEX "tenantMember_tenantId_idx" ON "tenant_member" ("tenant_id");
CREATE INDEX "tenantMember_userId_idx" ON "tenant_member" ("user_id");
CREATE UNIQUE INDEX "tenant_member_tenant_user_unique" ON "tenant_member" ("tenant_id", "user_id");

CREATE INDEX "tenantOauthConfig_tenantId_idx" ON "tenant_oauth_config" ("tenant_id");
CREATE UNIQUE INDEX "tenant_oauth_tenant_provider_unique" ON "tenant_oauth_config" ("tenant_id", "provider_id");

CREATE INDEX "tenantInvite_tenantId_idx" ON "tenant_invite" ("tenant_id");
CREATE INDEX "tenantInvite_email_idx" ON "tenant_invite" ("email");
CREATE INDEX "tenantInvite_invitedBy_idx" ON "tenant_invite" ("invited_by");
