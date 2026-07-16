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

[] Invites / domain join policies for tenant end-users

[] Session host binding (platform ↔ tenant cookie isolation)
