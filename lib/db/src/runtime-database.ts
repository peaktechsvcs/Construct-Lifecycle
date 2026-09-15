export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const runtimeMode = Boolean(env.RUNTIME_ENVIRONMENT_ID);
  if (!runtimeMode && env.RUNTIME_DATABASE_URL) {
    throw new Error("RUNTIME_DATABASE_URL cannot be set without RUNTIME_ENVIRONMENT_ID");
  }
  if (runtimeMode && !env.RUNTIME_DATABASE_URL) {
    throw new Error("RUNTIME_ENVIRONMENT_ID requires RUNTIME_DATABASE_URL");
  }
  const databaseUrl = runtimeMode ? env.RUNTIME_DATABASE_URL : env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL or RUNTIME_DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  return databaseUrl;
}

/**
 * Resolves the connection string used for schema migrations.
 *
 * Migrations need a session-level connection. Neon's pooled endpoints run
 * PgBouncer in transaction mode, which cannot hold the advisory locks and
 * session state that DDL requires, so a pooled URL here fails in confusing
 * ways: hangs, advisory-lock errors, or partially applied migrations.
 *
 * Resolution order mirrors resolveDatabaseUrl's fail-closed pairing:
 *   - isolated runtime  -> RUNTIME_DIRECT_URL, falling back to RUNTIME_DATABASE_URL
 *   - control plane     -> DIRECT_URL,         falling back to DATABASE_URL
 *
 * The fallback exists so single-endpoint Postgres (local Docker, self-hosted)
 * needs no extra configuration. When the fallback resolves to a Neon pooled
 * endpoint we throw instead, because that is always a misconfiguration.
 */
export function resolveDirectDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const runtimeMode = Boolean(env.RUNTIME_ENVIRONMENT_ID);

  if (!runtimeMode && env.RUNTIME_DIRECT_URL) {
    throw new Error("RUNTIME_DIRECT_URL cannot be set without RUNTIME_ENVIRONMENT_ID");
  }

  const explicit = runtimeMode ? env.RUNTIME_DIRECT_URL : env.DIRECT_URL;
  if (explicit) {
    return explicit;
  }

  // No dedicated direct URL configured — fall back to the runtime connection.
  // resolveDatabaseUrl enforces the runtime-identity pairing for us.
  const fallback = resolveDatabaseUrl(env);

  if (isPooledEndpoint(fallback)) {
    const expected = runtimeMode ? "RUNTIME_DIRECT_URL" : "DIRECT_URL";
    const source = runtimeMode ? "RUNTIME_DATABASE_URL" : "DATABASE_URL";
    throw new Error(
      `${expected} is not set and ${source} points at a pooled endpoint. ` +
        "Migrations require a direct (non-pooled) connection. Copy the " +
        "connection string with pooling disabled and set it as " +
        `${expected}.`,
    );
  }

  return fallback;
}

/**
 * Detects a connection pooler endpoint. Neon marks pooled endpoints with a
 * "-pooler" suffix on the host label; Supabase uses a "pooler." host prefix.
 * Both are transaction-mode PgBouncer and unsuitable for DDL.
 */
function isPooledEndpoint(connectionString: string): boolean {
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    // Non-URL connection strings (key=value libpq form, socket paths) are
    // never pooled endpoints we can detect, so let them through.
    return false;
  }
  return /-pooler\./.test(host) || host.startsWith("pooler.");
}