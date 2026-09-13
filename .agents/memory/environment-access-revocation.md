---
name: Environment access revocation
description: Explicitly distinguish legacy environment grants from an intentionally empty access set.
---

Environment access backfills must be tracked separately from access rows. An empty access-row set can be an intentional revocation, so row-count-based backfill silently restores access.

**Why:** The platform member controls allow administrators to revoke every environment, and legacy memberships still need a one-time compatibility backfill.

**How to apply:** Keep a membership-level configured marker (or equivalent explicit state); only backfill when that marker is unset, and mark new invitations and access updates as configured.