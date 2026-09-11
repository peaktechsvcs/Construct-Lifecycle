---
name: Stripe connector runtime
description: Stripe's attached Replit connection exposes the connector proxy but not a raw sync secret in this workspace.
---

Use the Replit Stripe connector proxy for runtime API operations when the connection does not expose a raw secret. Treat Stripe sync initialization and webhook verification as optional/fail-closed in that environment rather than preventing the API from starting.

**Why:** The attached Stripe connection is available to application code through `@replit/connectors-sdk`, but the connection-settings endpoint may return no `secret_key`; assuming a raw key makes the API fail during startup.

**How to apply:** Keep connector-proxy billing paths operational, never log or request a secret, and add a provider/runtime check before relying on synced Stripe tables or signed webhook processing.