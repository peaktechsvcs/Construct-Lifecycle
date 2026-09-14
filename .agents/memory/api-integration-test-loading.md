---
name: API integration test loading
description: Why database-backed API integration tests use a temporary esbuild bundle.
---

Bundle full API integration tests before running them with Node's test runner. Keep the bundle beside the API package so externalized dependencies resolve through the workspace.

**Why:** Node 24's native TypeScript stripping does not resolve this workspace's extensionless imports or directory imports. A bundle placed in the system temporary directory also cannot resolve dependencies externalized by the production-compatible build.

**How to apply:** Pure unit tests can continue using native type stripping. Tests that import the Express app or database package should run through the integration bundling harness, and assertions about actor profile fields should account for the test auth middleware syncing claims onto the local user bridge.