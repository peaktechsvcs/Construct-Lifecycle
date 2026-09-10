---
name: Date boundary normalization
description: OpenAPI date inputs are coerced to Date objects while Drizzle PostgreSQL date columns expect YYYY-MM-DD strings.
---

Normalize date-only fields at the API boundary before sending them to Drizzle, and let the response serialize back to the generated client’s date shape.

**Why:** The generated Zod schemas coerce OpenAPI `format: date` values into JavaScript `Date` objects, while Drizzle’s PostgreSQL `date` columns are typed as strings in this workspace.

**How to apply:** For create and update routes, convert date inputs with `toISOString().slice(0, 10)` before database writes.