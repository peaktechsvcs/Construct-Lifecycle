---
name: Development workspace bootstrap
description: The invariant required for the first development user to reach a usable workspace.
---

Development bootstrap must be recoverable after any partial first-request state: a local user may already be marked platform admin before tenant resolution runs, and the default tenant and a D/T/D environment still need to exist before context selection can succeed.

**Why:** The original flow skipped default-tenant creation for platform admins and skipped environment creation for platform admins, so a first request could persist the user and then return no workspace or no active environment.

**How to apply:** Keep development recovery idempotent, never apply it in production, allow later non-member users only through explicit membership, and ensure the selected development tenant has an active environment before saving user context.