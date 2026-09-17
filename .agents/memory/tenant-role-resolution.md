---
name: Tenant role resolution
description: How the client should determine the current tenant membership role for permission-gated UI.
---

Use the role attached to the API's active tenant context as the primary client-side permission source, with membership lookup only as a fallback. When a platform administrator also has a real membership, preserve that tenant-specific role; synthesize platform access only for tenants without membership.

**Why:** The context response already identifies the active tenant and its role. Recomputing the role by matching membership IDs can leave permission-gated actions hidden when client and server identifiers are represented differently, while replacing a real membership with `platform_admin` makes legitimate tenant mutations fail server-side.

**How to apply:** When adding tenant-scoped UI gates, consume the normalized active tenant role from the tenant provider instead of duplicating membership matching in individual pages. Keep synthetic platform access read-only unless the platform user has an explicit membership in that tenant.