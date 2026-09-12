---
name: Opportunities model
description: Durable rules for construction opportunity records and ownership.
---

Opportunities are separate tenant/environment-scoped records, not projects filtered by stage. Each opportunity belongs to an active business customer and may be assigned to a member of the same tenant.

**Why:** Opportunities have a distinct pre-project pipeline and ownership workflow; treating them as projects would mix lead qualification with delivery lifecycle data.

**How to apply:** Keep opportunity stages and CRUD behavior independent from project stages, and validate both customer and owner membership against the active tenant and environment.