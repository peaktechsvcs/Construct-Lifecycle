import { defineConfig } from "drizzle-kit";
import { resolveDirectDatabaseUrl } from "./src/runtime-database";

// Migrations in this package are hand-written SQL under ./migrations, applied
// by our own runner. drizzle-kit is used only for `push` against a dev branch
// and for `studio`. It deliberately has no `out` directory: `drizzle-kit
// generate` would create a second, parallel migration history that our runner
// knows nothing about.
//
// DDL needs a session-level connection. Neon's pooled endpoint is PgBouncer in
// transaction mode and cannot hold the advisory locks DDL requires, so this
// resolves DIRECT_URL and refuses to fall back onto a pooled URL.
const url = resolveDirectDatabaseUrl();

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});