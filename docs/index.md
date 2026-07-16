---
layout: home

hero:
  name: "better-auth-tenancy"
  text: "Multi-tenant auth for Better Auth"
  tagline: Tenant-scoped users, per-tenant OAuth, and management APIs — as a Better Auth plugin.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/kourosh-alasti/better-auth-tenancy

features:
  - icon: 🏢
    title: Tenant-scoped users
    details: The same email can sign up under different tenants as separate users. Sessions, accounts, and verification records are scoped by tenant.
  - icon: 👥
    title: Platform membership
    details: Platform users get owner / admin / member roles on tenants they manage, with a full membership CRUD API.
  - icon: ✉️
    title: Invites & policies
    details: Optional invite-only sign-up and email-domain allowlists. Tenant-scoped email verification via GET /tenant/verify-email.
  - icon: 🔐
    title: Per-tenant OAuth
    details: Store OAuth client credentials per tenant in the database, encrypted at rest. Fall back to global providers when no tenant config exists.
  - icon: 🛠
    title: Management APIs
    details: Create, update, list, and delete tenants, members, invites, and OAuth configs through typed Better Auth endpoints.
  - icon: 🔌
    title: Better Auth native
    details: Adds schema, endpoints, and a client plugin that integrate with Better Auth's adapter, session, and social provider systems.
---
