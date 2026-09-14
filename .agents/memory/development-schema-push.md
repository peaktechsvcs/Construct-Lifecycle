---
name: Development schema push
description: How to handle development schema reconciliation when unrelated data violates an existing foreign key.
---

When a full Drizzle schema push fails on an unrelated orphaned foreign key, apply and verify the requested additive migration directly in development instead of modifying or deleting unrelated data.

**Why:** Development data can contain legacy rows that prevent Drizzle's global reconciliation from reaching an otherwise safe additive table or index change.

**How to apply:** Keep the migration in the repository for publish-time schema management, use a focused development-only DDL application for verification, and report the unrelated blocker rather than hiding it.