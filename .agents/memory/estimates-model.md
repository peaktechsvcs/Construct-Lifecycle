---
name: Estimates model
description: Durable rules for estimate records and future provider synchronization.
---

Estimates are separate tenant/environment-scoped financial records. They can optionally link to a bid, keep a normalized cost build-up, and carry a vendor-neutral integration envelope: provider key, integration kind, sync status, external reference, and last-sync timestamp.

**Why:** Estimates may receive data from takeoff, estimating, pricing, or accounting systems, and no single provider should be required before a customer has an entitlement and connection.

**How to apply:** Keep totals derived from cost components, validate linked bids against the active customer environment, and treat provider metadata as reconciliation context until a connector implements import or sync behavior.