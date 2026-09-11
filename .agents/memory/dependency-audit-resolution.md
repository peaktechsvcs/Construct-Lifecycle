---
name: Dependency audit resolution
description: Safe handling of patched transitive npm dependencies in this workspace.
---

When a dependency audit identifies a patched transitive package, prefer the oldest mature patched release and a workspace override when the parent package has not selected it yet. Do not bypass the workspace minimum-release-age safeguard for newly published packages.

**Why:** The workspace uses a package-age control to reduce supply-chain risk, and newly released fixes may be unavailable until they mature. The lockfile can still be remediated safely with a known mature patched version.

**How to apply:** Check the advisory’s minimum patched version, verify package maturity through a normal install, add the narrowest override needed, refresh the lockfile, and run the audit plus affected package checks.