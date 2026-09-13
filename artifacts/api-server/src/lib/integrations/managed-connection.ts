const unusableConnectorStatuses = new Set(["disconnected", "failed", "invalid", "revoked", "expired"]);

export function selectManagedConnection(
  connections: Array<{ id: string; status?: string | null }>,
) {
  const usable = connections.filter((connection) =>
    !unusableConnectorStatuses.has(connection.status?.toLowerCase() ?? ""),
  );
  if (usable.length === 0) return { kind: "missing" as const };
  if (usable.length > 1) return { kind: "ambiguous" as const };
  return { kind: "selected" as const, connection: usable[0] };
}

export const managedCredentialsReference = (connectorName: string, connectionId: string) =>
  `replit-connector:${connectorName}:${connectionId}`;

type HealthConnection = {
  status: string;
  lastSuccessfulSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastFailureAt: Date | null;
  lastError: string | null;
};

type HealthJob = {
  status: string;
  nextRetryAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
};

export function summarizeIntegrationHealth(
  connection: HealthConnection,
  jobs: HealthJob[],
) {
  const retryJobs = jobs.filter((job) => job.status === "retry");
  const deadLetterJobs = jobs.filter((job) => job.status === "dead_letter");
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const latestFailureJob = [...jobs]
    .filter((job) => Boolean(job.lastError))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const nextRetryAt = retryJobs
    .map((job) => job.nextRetryAt)
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const latestError = connection.lastError ?? latestFailureJob?.lastError ?? null;
  const lastFailureAt = connection.lastFailureAt ?? latestFailureJob?.updatedAt ?? null;

  let healthStatus: "unknown" | "healthy" | "degraded" | "failed" | "disabled";
  if (connection.status === "disabled") {
    healthStatus = "disabled";
  } else if (deadLetterJobs.length > 0 || connection.status === "failed") {
    healthStatus = "failed";
  } else if (
    connection.status === "warning"
    || retryJobs.length > 0
    || failedJobs.length > 0
    || connection.lastSyncStatus === "failed"
  ) {
    healthStatus = "degraded";
  } else if (connection.status !== "connected") {
    healthStatus = "unknown";
  } else if (connection.lastSuccessfulSyncAt || connection.lastSyncStatus === "success") {
    healthStatus = "healthy";
  } else {
    healthStatus = "unknown";
  }

  return {
    healthStatus,
    retryCount: retryJobs.length,
    deadLetterCount: deadLetterJobs.length,
    nextRetryAt,
    lastFailureAt,
    lastError: latestError,
  };
}