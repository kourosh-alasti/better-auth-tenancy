[x] Add Tenant ownership model

- platform users own tenants they create (`ownerId`)
- management scoped to ownership (or global `canManageTenants`)

[x] Tenant RBAC beyond ownership

- `tenantMember` with roles owner / admin / member
- member add / list / update / remove endpoints

[x] Per-tenant email uniqueness at the DB layer

- documented partial / composite unique indexes
- demo Drizzle schema includes them
- sign-up maps unique-constraint races to USER_ALREADY_EXISTS

[x] Invites / domain join policies for tenant end-users

- `requireInviteForTenantSignUp` + `allowedEmailDomains`
- `tenantInvite` create / list / revoke endpoints
- Enforced on email sign-up and first-time OAuth registration

[x] Session host binding (platform ↔ tenant cookie isolation)

- `hooks.before` enforces the session's tenant id matches the request's
  resolved tenant (or that platform requests carry no tenant session)
- `isPlatformRequest` / `enforceSessionTenant` options; `SESSION_TENANT_MISMATCH`
- tenant management endpoints (create/update/delete/members/OAuth config)
  are intentionally excluded — they manage a target tenant, not the
  caller's own context
