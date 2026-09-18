---
name: Schedule edit concurrency
description: Optimistic concurrency behavior for schedule and milestone edits
---

Use a client-visible `updatedAt` value as a stale-edit token only after normalizing database comparisons to the precision preserved by JSON dates. Newly written schedule versions should be stamped by the application rather than relying on a database default with finer precision.

**Why:** PostgreSQL timestamp defaults can retain sub-millisecond precision that JavaScript `Date` serialization drops, causing a freshly loaded record to be rejected as stale if compared byte-for-byte.

**How to apply:** Keep the update predicate scoped to tenant, environment, project, item, and the expected version. Return a structured conflict response and preserve the user's draft; consider an integer version or stronger ETag if same-millisecond writes need guaranteed separation.