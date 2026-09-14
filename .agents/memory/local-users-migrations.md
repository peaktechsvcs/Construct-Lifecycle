---
name: Local users in migrations
description: Foreign keys from additive migrations must target the project's physical user and environment tables.
---

Additive database migrations that reference application users or customer environments must use the physical `local_users` and `customer_environments` tables rather than assuming model-like names such as `users` or `environments`.

**Why:** The schema package uses the model names `usersTable` and `environmentsTable`, but the physical PostgreSQL tables are `local_users` and `customer_environments`; migrations using the model-like names fail before creating the new table.

**How to apply:** Check the physical table name in the owning schema before writing foreign-key SQL for user-owned or environment-scoped records.