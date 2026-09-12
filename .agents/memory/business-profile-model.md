---
name: Tenant business profile model
description: Business types are additive tenant capabilities that drive entitlement filtering.
---

Select business types as an additive set rather than a single role; mixed tenants receive the union of the selected capabilities, while removing a type changes visibility only and does not delete existing records.

**Why:** Construction organizations often operate across general contracting, trade, and supplier work. A single role would hide needed workflows, and destructive cleanup would make profile changes unsafe.

**How to apply:** Keep the normalized tenant business-type records as the source for feature entitlement, navigation, direct-route checks, and future role-specific workflows. Require owner/admin authorization and an impact preview for changes.