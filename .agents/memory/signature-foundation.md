---
name: Signature foundation
description: Provider-neutral signature preparation and capability boundaries for submittal packages.
---

Signature preparation is separate from legal sending: assembled package versions are explicitly marked ready, signer data is stored in tenant/environment-scoped records, and no send action exists until both a registered provider adapter and a connected, entitled e-sign integration are present.

**Why:** The provider is intentionally selected later, and internal readiness must never be represented as a legally binding signature.

**How to apply:** Keep provider credentials out of submittal records; future adapters must implement send, status, cancellation, and signed-document retrieval without changing the package model.