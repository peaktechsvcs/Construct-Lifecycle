---
name: Bids model
description: Durable rules for bid pipeline records and takeoff/estimating integration readiness.
---

Bids are separate tenant/environment-scoped records that may link to an opportunity. A bid can be general or specialty and can cover a full or partial scope. Takeoff and estimating systems are represented independently with provider names and none/full/partial coverage, leaving actual connectors decoupled from the bid workflow.

**Why:** Construction bids vary by specialty and may use one system for the full bid or different systems for portions of the scope; a single mandatory vendor integration would not fit every bid.

**How to apply:** Keep bid pipeline ownership and submission state independent from provider connectors, validate linked opportunities within the active tenant/environment, and extend partial bids with specialty-level scopes before adding vendor-specific sync behavior.