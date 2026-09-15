---
name: Stripe webhook idempotency
description: Durable application-side protection for StripeSync webhook retries.
---

StripeSync validates webhook signatures but does not persist processed event IDs. Keep an application-owned receipt keyed by the verified Stripe event ID, serialize same-event deliveries with a transaction-scoped advisory lock, and insert the receipt only after processing succeeds.

**Why:** A receipt written before verification can be poisoned by an invalid request, while an in-memory cache cannot protect concurrent requests or replay after a process restart. Recording only after success lets failed processing retry without duplicating successful billing changes.

**How to apply:** Verify each delivery before checking the receipt. For a first delivery, process the verified event while holding the event lock, then commit the receipt and related application changes. A later delivery waits for the lock, sees the receipt, and does not invoke StripeSync again.