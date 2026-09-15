---
name: Billing override recovery
description: How effective subscription access should behave when provider verification fails.
---

If billing or subscription verification fails, paid capabilities must fail closed while tenant-scoped entitlement overrides remain readable and authoritative.

**Why:** A provider outage or missing synced billing record must not unlock plan features, but dropping support grants during the same failure would incorrectly deny explicitly approved recovery access.

**How to apply:** Resolve overrides independently of provider reads, preserve explicit `enabled: false` denials, and apply `enabled: true` grants only to the tenant and capability being evaluated.