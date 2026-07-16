import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

export const TENANT_AUTH_ERROR_CODES = defineErrorCodes({
  TENANT_ID_REQUIRED: "Tenant id is required",
  TENANT_NOT_FOUND: "Tenant not found",
  TENANT_ALREADY_EXISTS: "A tenant with this slug already exists",
  TENANT_MANAGEMENT_NOT_ALLOWED:
    "You are not allowed to manage tenants or tenant OAuth configurations",
  TENANT_NOT_OWNED: "You do not own this tenant",
  MEMBER_ALREADY_EXISTS: "This user is already a member of the tenant",
  MEMBER_NOT_FOUND: "Tenant member not found",
  CANNOT_REMOVE_LAST_OWNER: "Cannot remove or demote the last owner of the tenant",
  PLATFORM_USER_NOT_FOUND: "Platform user not found",
  PLATFORM_USER_REQUIRED: "Provide a platform user id or email",
  USER_ALREADY_EXISTS: "A user with this email already exists for this tenant",
  INVALID_EMAIL_OR_PASSWORD: "Invalid email or password",
  EMAIL_NOT_VERIFIED: "Email is not verified",
  EMAIL_PASSWORD_NOT_ENABLED: "Email and password sign in is not enabled",
  PROVIDER_NOT_FOUND: "OAuth provider not found. Configure it for the tenant or in the auth config",
  UNSUPPORTED_PROVIDER: "This provider is not a supported built-in social provider",
  OAUTH_CONFIG_NOT_FOUND: "OAuth configuration not found for this tenant",
  FAILED_TO_CREATE_USER: "Failed to create user",
  FAILED_TO_CREATE_SESSION: "Failed to create session",
  INVALID_VERIFICATION_TOKEN: "Invalid or unsupported verification token",
  SESSION_TENANT_MISMATCH: "This session cannot be used for this tenant or host",
  INVALID_CALLBACK_URL: "Invalid callbackURL",
  INVALID_SLUG:
    "Slug must be 2-63 lowercase letters, digits, or hyphens, and cannot start or end with a hyphen",
  SLUG_RESERVED: "This slug is reserved",
});
