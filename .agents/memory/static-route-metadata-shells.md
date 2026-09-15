---
name: Static route metadata shells
description: How static SPA artifacts expose route-specific initial HTML metadata.
---

Static SPA deployments that rewrite unknown paths to one index shell need build-emitted exact route files for any public route whose initial metadata or body differs. In Vite dev, route transforms must use the original request URL and a route-aware middleware because the transformed index can otherwise be cached across paths. Extensionless route files are resolved before the fallback rewrite, while relying only on client-side rendering or head updates is too late for crawlers.

**Why:** Preview bots can read the initial response without running the client bundle, and a wildcard rewrite or shared dev transform otherwise serves the landing page for every public route.

**How to apply:** Share the static route content with the client page, emit exact route shells during the build, and verify repeated direct requests to `/`, `/pricing`, and `/subscribe` in both dev and production output.