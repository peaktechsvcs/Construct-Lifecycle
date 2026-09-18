---
name: Control history cache invalidation
description: Keeps event-backed audit panels current after mutations update the related record.
---

When a mutation appends an audit event to a summary response, updating only the changed record in the client cache is insufficient. Invalidate the owning summary query after success so the event stream is refetched and the audit panel reflects the mutation immediately.

**Why:** The record row and its audit history have separate cache consumers even when the server returns both from one summary endpoint; optimistic row updates otherwise leave the visible history stale until navigation or reload.

**How to apply:** For project-control mutations, patch the changed record for instant feedback and invalidate the project controls query for the authoritative event list.