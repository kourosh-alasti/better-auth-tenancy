import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

export const TENANT_AUTH_ERROR_CODES = defineErrorCodes({
  TENANT_ID_REQUIRED: "Tenant id is required",
  TENANT_NOT_FOUND: "Tenant not found",
  TENANT_ALREADY_EXISTS: "A tenant with this slug already exists",
  TENANT_MANAGEMENT_NOT_ALLOWED:
    "You are not allowed to manage tenants or tenant OAuth configurations",
  USER_ALREADY_EXISTS: "A user with this email already exists for this tenant",
  INVALID_EMAIL_OR_PASSWORD: "Invalid email or password",
  EMAIL_NOT_VERIFIED: "Email is not verified",
  EMAIL_PASSWORD_NOT_ENABLED: "Email and password sign in is not enabled",
  PROVIDER_NOT_FOUND: "OAuth provider not found. Configure it for the tenant or in the auth config",
  UNSUPPORTED_PROVIDER: "This provider is not a supported built-in social provider",
  OAUTH_CONFIG_NOT_FOUND: "OAuth configuration not found for this tenant",
  FAILED_TO_CREATE_USER: "Failed to create user",
  FAILED_TO_CREATE_SESSION: "Failed to create session",
});
