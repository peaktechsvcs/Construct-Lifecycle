---
name: Recovery operation durability
description: Destructive environment recovery must complete independently of browser polling and survive interrupted provider startup.
---

Recovery operations require a persisted idempotency claim, a reclaimable database-backed startup lease, and server-side reconciliation. Browser polling is for operator visibility only, not the mechanism that completes restore, refresh, or rollback state.

**Why:** A process or browser can stop after a provider accepts work but before the provider operation ID is stored. Without a lease and server worker, operations can remain pending forever; without conditional terminal transitions, concurrent pollers can duplicate audit effects.

**How to apply:** For future destructive provider workflows, persist the claim before provider execution, replay only with the provider's persisted idempotency key after a stale lease, run bounded reconciliation in the control-plane server, and make terminal state updates conditional.