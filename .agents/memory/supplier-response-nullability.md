---
name: Supplier response nullability
description: Defensive handling for optional nested supplier order response collections.
---

Supplier order pages must treat omitted nested collections, including delivery and line arrays, as empty when calculating metrics, hydrating drafts, or rendering receiving details.

**Why:** Summary and test-fixture responses can validly omit nested collections even when the top-level order is present; assuming arrays always exist can crash the entire protected workspace.

**How to apply:** Use null-safe collection traversal at every render and state-hydration boundary, while keeping required top-level order fields validated by the API contract.