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