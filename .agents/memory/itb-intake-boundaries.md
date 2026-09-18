---
name: ITB intake boundaries
description: Provider-neutral mailbox intake and review gates for turning untrusted procurement messages into pipeline records.
---

Mailbox intake must use the Replit-managed connector lifecycle rather than collecting provider credentials in the app. Gmail is the first supported connector because it is available in the integration catalog.

**Why:** Provider authorization, token refresh, and scope handling belong to the managed connector; source email and attachments are untrusted content and must not create opportunities or bids without an explicit human approval.

**How to apply:** Keep mailbox reads bounded by explicit search filters and tenant/environment-scoped cursors, store attachment bytes in protected object storage, preserve source evidence, expose field confidence, and require review before pipeline mutations.

Mailbox provider changes must clear the prior preview state, apply the provider's bounded default query, and preserve the selected provider in the returned preview records.

**Why:** Gmail and Microsoft Graph use different search contracts; retaining a previous query or ambiguous provider state can show stale evidence or send the wrong request after a provider switch.

**How to apply:** Guard controlled provider changes against redundant callbacks, include the provider in the query key, and exercise selection plus Preview for each supported provider in browser coverage.