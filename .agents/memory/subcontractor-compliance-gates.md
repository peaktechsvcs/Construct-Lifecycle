---
name: Subcontractor compliance gates
description: Durable rule for how trade-partner compliance requirements affect project work.
---

Compliance requirements are project-scoped and each requirement declares which lifecycle gate it can block: award, mobilization, billing, or closeout. A trade partner is not globally “cleared” by one undifferentiated status; the active gate is evaluated against qualification, document expiry, and only the requirements that target that gate.

**Why:** General contractors may need to allow a trade to prepare or mobilize while a billing-specific document is still under review, and different projects can impose different requirements on the same partner.

**How to apply:** Keep gate evaluation tenant/environment scoped, preserve approved or waived requirements as non-blocking, and store document bytes in protected object storage while the database retains only metadata and protected paths.