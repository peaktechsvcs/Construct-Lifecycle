---
name: Integration test actor names
description: Explains why API integration tests return Clerk test IDs as actor display names.
---

The API integration test authentication middleware derives the session name from the `x-test-clerk-user-id` header, then updates the local user bridge with that value. Actor display-name assertions in those tests should therefore use the stable test Clerk ID unless the test explicitly supplies a profile claim.

**Why:** The test path intentionally avoids a live Clerk profile lookup, so seeded human-readable display names are overwritten during authenticated requests.

**How to apply:** Assert both the persisted actor ID and returned display name using the test Clerk ID for integration coverage; keep production actor rendering based on the stored user display name.