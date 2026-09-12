---
name: ITB intake boundaries
description: Provider-neutral mailbox intake and review gates for turning untrusted procurement messages into pipeline records.
---

Mailbox intake must use the Replit-managed connector lifecycle rather than collecting provider credentials in the app. Gmail is the first supported connector because it is available in the integration catalog.

**Why:** Provider authorization, token refresh, and scope handling belong to the managed connector; source email and attachments are untrusted content and must not create opportunities or bids without an explicit human approval.

**How to apply:** Keep mailbox reads bounded by explicit search filters and tenant/environment-scoped cursors, store attachment bytes in protected object storage, preserve source evidence, expose field confidence, and require review before pipeline mutations.