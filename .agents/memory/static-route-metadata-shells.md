---
name: Static route metadata shells
description: How static SPA artifacts expose route-specific initial HTML metadata.
---

Static SPA deployments that rewrite unknown paths to one index shell need build-emitted exact route files for any public route whose initial metadata differs. Extensionless route files are resolved before the fallback rewrite, while relying only on client-side head updates is too late for crawlers.

**Why:** Preview bots can read the initial response without running the client bundle, and a wildcard rewrite otherwise serves the landing page metadata for every public route.

**How to apply:** Emit route-specific shells during the build and verify the exact non-trailing-slash URLs, especially when their canonical URLs intentionally omit a trailing slash.