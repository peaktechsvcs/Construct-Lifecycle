---
name: Integration job lifecycle
description: Durable rules for recording managed connector work and synchronizing integration health.
---

Every provider operation that performs connector work must create a job scoped by tenant, environment, integration, and provider. Use canonical processing, succeeded, retry, failed, and dead-letter states rather than provider-specific status names; update integration timestamps and health in the same lifecycle transaction.

**Why:** Health dashboards and manual retry controls depend on consistent job states. A connector request that only writes domain data can leave the integration appearing unused, and raw provider errors can expose credential material.

**How to apply:** Keep retry scheduling bounded, preserve the last successful timestamp on failures, sanitize connector errors before writing jobs, health, or audit events, and include tenant/environment predicates on every job and integration update.