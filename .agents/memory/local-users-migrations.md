---
name: Local users in migrations
description: Foreign keys from additive migrations must target the project's local user table.
---

Additive database migrations that reference application users must use the existing `local_users` table rather than assuming a generic `users` table.

**Why:** The schema package names the Drizzle model `usersTable`, but the physical PostgreSQL table is `local_users`; a migration using `users` fails before creating the new table.

**How to apply:** Check the physical table name in the owning schema before writing foreign-key SQL for user-owned records.