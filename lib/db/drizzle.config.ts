import { defineConfig } from "drizzle-kit";
import { resolveDirectDatabaseUrl } from "./src/runtime-database";

// Migrations need a session-level connection; see resolveDirectDatabaseUrl.
// This throws with an actionable message when DIRECT_URL is missing and
// DATABASE_URL points at a pooler.
const url = resolveDirectDatabaseUrl();

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  // Surfaces the statements drizzle-kit is about to run. Worth keeping while
  // the schema is still moving.
  verbose: true,
  // Requires confirmation before destructive changes. Do not disable.
  strict: true,
});