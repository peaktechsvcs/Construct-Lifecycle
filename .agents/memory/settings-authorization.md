---
name: Settings authorization boundary
description: Admin-only tenant settings while preserving published branding for all authenticated workspace users.
---

Tenant settings data that includes drafts, membership management, or integration configuration must remain owner/admin-only. Published branding used to theme the application is a separate read-only response that excludes drafts.

**Why:** The app must apply customer branding for every authenticated user without exposing editable tenant configuration to non-administrators.

**How to apply:** Keep frontend settings visibility and server authorization aligned with the active tenant role; use a published-only branding read for global theme hydration.