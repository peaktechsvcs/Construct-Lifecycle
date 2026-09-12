---
name: Feature visibility and feedback
description: Upcoming Construct Lifecycle features are controlled by platform flags and tenant roadmap voting.
---

Keep unfinished features disabled by default in the server-backed platform feature catalog. Tenant navigation and direct Coming soon routes must both honor the flag; CLC platform administrators can enable an item to advertise it.

**Why:** Hard-coded Coming soon links crowded the tenant menu and allowed hidden roadmap work to be reached directly. A server-side gate keeps visibility consistent across sessions and environments.

**How to apply:** Treat the catalog key as the stable contract for the sidebar, settings subsections, feature-control UI, and feedback poll. Tenant feedback should allow one current vote per tenant user and aggregate counts globally.