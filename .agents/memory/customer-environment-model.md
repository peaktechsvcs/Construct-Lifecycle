---
name: Customer environment model
description: Durable rules for Construct Lifecycle customer environments and release promotion.
---

Each customer owns exactly two environment concepts: Production and one combined Development / Test / Demo environment. D/T/D belongs to the same customer and must never be represented as a second customer. Transactional data never promotes from D/T/D to Production.

**Why:** The approved model follows Business Central-style customer sandboxes while preserving one customer identity, membership structure, and customer relationship.

**How to apply:** Scope operational data and mutable configuration to customer plus environment. Keep customer identity and membership customer-level. Security and platform-critical releases may deploy directly; feature releases require customer approval after validation in Customer D/T/D.