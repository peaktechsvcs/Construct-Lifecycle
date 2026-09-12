---
name: Notifications data model
description: Notification inbox behavior and source records for Construct Lifecycle.
---

Notifications are derived from tenant/environment-scoped project activity and open follow-ups that are due or overdue. The database stores only per-user read state keyed by a stable notification key.

**Why:** Existing activity and follow-up records are already the system of record; duplicating them into a second event table would create stale or inconsistent notifications.

**How to apply:** Keep every notification query constrained by tenant, environment, and authenticated local user. New notification sources should use stable keys and preserve read state across refreshes without leaking data between customer workspaces.