---
name: Release gate validation harness
description: Durable guidance for testing release verification without changing the real dependency audit or cleanup behavior.
---

Release-gate regression checks should invoke the real release command and intercept only the audit subprocess with a temporary executable shim. The nested command must use an explicit environment guard to skip recursive wiring validation, while the synthetic audit must still fail before cleanup.

**Why:** Testing only the validator or mocking the release script can let deployment wiring regress while unit checks remain green. The real command also exposes ordering errors, such as pruning the package store after a failed audit.

**How to apply:** Keep the shim isolated in a temporary directory, create its `bin` directory before writing the executable, delegate all non-audit arguments to the real package manager, and assert the failure output includes the affected package and severity.