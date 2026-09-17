---
name: Tenant role resolution
description: How the client should determine the current tenant membership role for permission-gated UI.
---

Use the role attached to the API's active tenant context as the primary client-side permission source, with membership lookup only as a fallback.

**Why:** The context response already identifies the active tenant and its role. Recomputing the role by matching membership IDs can leave permission-gated actions hidden when client and server identifiers are represented differently.

**How to apply:** When adding tenant-scoped UI gates, consume the normalized active tenant role from the tenant provider instead of duplicating membership matching in individual pages.