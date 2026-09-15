---
name: Node strip-types import resolution
description: Direct Node tests using the workspace strip-types runner need explicit extensions for local TypeScript imports.
---

When a CLC utility is imported directly by the Node strip-types test runner, local relative imports must include their `.ts` extension even though Vite accepts extensionless imports.

**Why:** The application bundler resolves extensionless modules, but Node's direct ESM resolver does not apply the same TypeScript resolution behavior.

**How to apply:** Add explicit `.ts` extensions to local imports in utilities covered by direct Node tests, then run the package's full test script rather than only a bundler build.