---
name: Clerk environment identity boundary
description: Replit-managed Clerk uses separate Development and Production user stores and tenant access is keyed by the environment-specific Clerk user ID.
---

Replit-managed Clerk Development and Production users cannot be merged by matching a Google email. Treat the Production Clerk user as a distinct identity and explicitly provision its tenant or platform-admin access.

**Why:** The same Google account can authenticate successfully in both environments while receiving different Clerk user IDs. Automatically merging by email would cross the authentication boundary and could grant the wrong tenant access.

**How to apply:** Keep tenant membership lookup keyed to the current environment's Clerk user ID. For platform owners, grant a separate platform-admin flag and expose a controlled tenant switcher; do not copy platform-admin status into customer memberships or silently grant customer-owner mutation rights.