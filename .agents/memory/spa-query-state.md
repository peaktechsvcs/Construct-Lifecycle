---
name: SPA query-state handoffs
description: Modal and deep-link flags must survive router navigation even when the router location omits the browser search string.
---

URL flags that control a modal or preselected form should read the router location with a browser URL search fallback, and cleanup should use the same source.

**Why:** The empty-state link preserved `?create=1` in the browser URL, but the router location used by the page omitted the search portion after SPA navigation, so the permission-gated page never opened its modal.

**How to apply:** When adding query-driven UI state, test the real in-app link rather than only loading the destination URL directly; verify both opening and close-state cleanup.