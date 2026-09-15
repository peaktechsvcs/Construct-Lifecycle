---
name: OpenAPI codegen contract
description: The source OpenAPI document must define every schema represented by generated clients before regeneration.
---

Generated API clients are disposable outputs. Before running codegen, repair missing or stale source schemas and indentation in the OpenAPI contract rather than preserving generated files by hand.

**Why:** Orval cleans output directories before validation; an unresolved reference can delete generated types, while incomplete source schemas can silently remove fields from otherwise-used client types.

**How to apply:** Validate the OpenAPI document first, reconcile any source/generated drift, then regenerate both the React client and Zod package together. Refresh the client package's declaration build when project references resolve `dist` types. If an operation combines path and query parameters, check for Orval's duplicate `*Params` export and keep the cleanup in the codegen postprocess rather than editing generated output by hand.