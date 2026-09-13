---
name: Customer environment model
description: Durable rules for Construct Lifecycle customer environments and release promotion.
---

Each customer owns exactly two environment concepts: Production and one combined Development / Test / Demo environment. D/T/D belongs to the same customer and must never be represented as a second customer. Transactional data never promotes from D/T/D to Production. Feature promotion requires a deployed, validated, customer-approved D/T/D assignment for the same customer; platform operators cannot act as the customer approver. Only strictly validated immutable application/configuration artifact metadata can promote.

An environment is not selectable until its runtime, database, storage, queue, secrets, jobs, and logs resources are all provider-confirmed ready. Provisioning, refresh, backup, restore, and rollback must use idempotent provider operations and fail closed when no real provider adapter is configured. Runtime forwarding trust is unique per environment and bound to both customer and environment; a key shared across customer runtimes is never acceptable.

**Why:** The approved model follows Business Central-style customer sandboxes while preserving one customer identity, membership structure, and customer relationship.

**How to apply:** Scope operational data and mutable configuration to customer plus environment. Keep customer identity and membership customer-level. Security and platform-critical releases may deploy directly when mandatory. Re-check the same-customer D/T/D source at production deployment, require explicit environment access and ready isolated resources for customer actions, and reject or deprecate releases with invalid artifact metadata.