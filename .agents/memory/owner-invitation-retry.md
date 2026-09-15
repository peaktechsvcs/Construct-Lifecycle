---
name: Owner invitation retry behavior
description: Customer workspace creation treats owner invitation persistence as a post-commit, retryable partial-success step.
---

Workspace creation must remain usable when optional owner invitation persistence fails after the workspace transaction commits. The API should return an explicit partial-success status, keep the invitation error generic, and direct operators to retry from customer access; invitation creation must serialize active-email checks per tenant so concurrent retries cannot create duplicates.

**Why:** Invitation persistence is optional onboarding work. Rolling back or reporting total failure after a committed workspace creates a misleading recovery state, while an unlocked check-then-insert can create multiple active invitations during retries.

**How to apply:** Keep workspace setup atomic and invitation creation separate. Log only safe tenant/operation metadata for invitation failures; never include email, tokens, token hashes, provider details, or raw errors in the response or structured log fields.