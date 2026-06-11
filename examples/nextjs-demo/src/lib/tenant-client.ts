import { authClient } from "@/lib/auth-client";

type TenantEmailSignUpBody = {
  tenantId: string;
  name: string;
  email: string;
  password: string;
};

type TenantEmailSignInBody = {
  tenantId: string;
  email: string;
  password: string;
};

type TenantSocialSignInBody = {
  tenantId: string;
  provider: "google";
  callbackURL: string;
};

type ClientResult<T> = Promise<{
  data: T | null;
  error: { message?: string; statusText?: string } | null;
}>;

type TenantAuthClient = {
  signUp: {
    email: (body: TenantEmailSignUpBody) => ClientResult<{ token?: string }>;
  };
  signIn: {
    email: (body: TenantEmailSignInBody) => ClientResult<{ token?: string }>;
    social: (body: TenantSocialSignInBody) => ClientResult<{ url?: string }>;
  };
};

export const tenantClient = (authClient as typeof authClient & { tenant: TenantAuthClient }).tenant;
