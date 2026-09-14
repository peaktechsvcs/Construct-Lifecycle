---
name: OpenAPI codegen contract
description: The source OpenAPI document must define every schema represented by generated clients before regeneration.
---

Generated API clients are disposable outputs. Before running codegen, repair missing or stale source schemas in the OpenAPI contract rather than preserving generated files by hand.

**Why:** Orval cleans output directories before validation; an unresolved reference can delete generated types, while incomplete source schemas can silently remove fields from otherwise-used client types.

**How to apply:** Validate the OpenAPI document first, reconcile any source/generated drift, then regenerate both the React client and Zod package together.