---
name: Supplier queue deep links
description: Deep-link behavior and same-path query-state handling for supplier procurement queues.
---

Supplier queue routes must treat a requested quote or order as unavailable when it is malformed, outside the active tenant/environment, or no longer belongs to the current queue; never silently replace it with the first visible record. Same-path query changes need an explicit `window.location.search` dependency when route state is memoized.

**Why:** The router can update the browser query string without changing the pathname, so memoized query state can otherwise retain the stale ID. Queue fallback then risks making a stale link appear to open another order.

**How to apply:** Preserve the requested query parameter, render an unavailable state, and let the user select a visible row explicitly. Keep detail requests scoped by the existing tenant/environment-aware API handlers.