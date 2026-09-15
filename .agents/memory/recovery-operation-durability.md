---
name: Recovery operation durability
description: Destructive environment recovery must complete independently of browser polling and survive interrupted provider startup.
---

Destructive recovery must continue safely without browser polling, and every stage transition must leave one truthful, recoverable durable state.

**Why:** A process can stop after external work succeeds but before local state is stored, and older non-atomic writes may leave terminal records partially applied.

**How to apply:** Distinguish definitive provider failure from retryable local interruption, commit linked state and audit effects atomically, and reconcile both active work and partial terminal history on the server.