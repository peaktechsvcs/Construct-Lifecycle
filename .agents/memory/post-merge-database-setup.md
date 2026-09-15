---
name: Post-merge database setup
description: Constraints for the automated development database setup that runs after task merges.
---

The automated post-merge database setup runs without a TTY, so Drizzle schema pushes must use its explicit noninteractive approval flag. Schema introspection can take substantially longer than a short workflow default timeout.

**Why:** A merge setup was killed during schema introspection at the 20-second default, and the retry then failed because the schema tool received a TTY-only confirmation request.

**How to apply:** Keep the production guard, invoke the workspace Drizzle binary directly with `--force` for the development-only post-merge push, and keep the post-merge timeout comfortably above the measured schema-pull duration.