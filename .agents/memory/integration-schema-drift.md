---
name: Integration schema drift
description: How to keep focused API regression tests runnable when the local database lags the source schema.
---

When a focused API route does not depend on tenant-environment provisioning, run its integration coverage through the signed runtime boundary rather than coupling it to newer control-plane columns.

**Why:** The local control database can be behind the current Drizzle source schema. Tenant-context setup may fail before an otherwise unrelated route is exercised, hiding the result of the intended regression test.

**How to apply:** Keep the test's runtime database connection pointed at the same local database with a distinct runtime connection string, seed only the route's required records, and sign each request with a fresh runtime nonce. Track the underlying migration gap separately instead of broadening the feature test.