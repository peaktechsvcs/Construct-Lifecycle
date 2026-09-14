import { and, eq } from "drizzle-orm";
import {
  db,
  integrationAuditEventsTable,
  integrationJobsTable,
  integrationsTable,
} from "@workspace/db";

export type IntegrationJobScope = {
  tenantId: number;
  environmentId: number;
  integrationId: number;
  providerKey: string;
};

export const INTEGRATION_JOB_MAX_ATTEMPTS = 3;

const unavailableStatuses = new Set(["not_connected", "disconnected", "failed", "invalid", "revoked", "expired"]);

export const isIntegrationAvailable = (status: string) => !unavailableStatuses.has(status);

export const sanitizeIntegrationError = (error: unknown) => {
  const message = (error instanceof Error ? error.message : "Connector request failed")
    .replace(/[\r\n]/g, " ")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:access_token|token|api_key|apikey|secret)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 240);
  return message || "Connector request failed";
};

export const getAvailableIntegration = async (scope: Pick<IntegrationJobScope, "tenantId" | "environmentId" | "providerKey">) => {
  const [integration] = await db.select().from(integrationsTable).where(and(
    eq(integrationsTable.tenantId, scope.tenantId),
    eq(integrationsTable.environmentId, scope.environmentId),
    eq(integrationsTable.providerKey, scope.providerKey),
  )).limit(1);
  return integration && isIntegrationAvailable(integration.status) ? integration : null;
};

export async function startIntegrationJob(
  scope: IntegrationJobScope,
  jobType: string,
  maxAttempts = INTEGRATION_JOB_MAX_ATTEMPTS,
) {
  const [job] = await db.insert(integrationJobsTable).values({
    tenantId: scope.tenantId,
    environmentId: scope.environmentId,
    integrationId: scope.integrationId,
    providerKey: scope.providerKey,
    jobType,
    status: "processing",
    attempts: 1,
    maxAttempts,
    nextRetryAt: null,
    lastError: null,
    deadLetteredAt: null,
    completedAt: null,
  }).returning();
  return job;
}

export async function markIntegrationJobSucceeded(
  scope: IntegrationJobScope,
  job: typeof integrationJobsTable.$inferSelect,
) {
  const completedAt = new Date();
  return db.transaction(async (tx) => {
    const [updatedJob] = await tx.update(integrationJobsTable).set({
      status: "succeeded",
      nextRetryAt: null,
      lastError: null,
      deadLetteredAt: null,
      completedAt,
      updatedAt: completedAt,
    }).where(and(
      eq(integrationJobsTable.id, job.id),
      eq(integrationJobsTable.tenantId, scope.tenantId),
      eq(integrationJobsTable.environmentId, scope.environmentId),
      eq(integrationJobsTable.integrationId, scope.integrationId),
      eq(integrationJobsTable.providerKey, scope.providerKey),
    )).returning();
    if (!updatedJob) throw new Error("Integration job is no longer in the active environment");

    await tx.update(integrationsTable).set({
      lastSyncAt: completedAt,
      lastSuccessfulSyncAt: completedAt,
      lastSyncStatus: "success",
      lastFailureAt: null,
      lastError: null,
      status: "connected",
      updatedAt: completedAt,
    }).where(and(
      eq(integrationsTable.id, scope.integrationId),
      eq(integrationsTable.tenantId, scope.tenantId),
      eq(integrationsTable.environmentId, scope.environmentId),
      eq(integrationsTable.providerKey, scope.providerKey),
    ));

    await tx.insert(integrationAuditEventsTable).values({
      tenantId: scope.tenantId,
      environmentId: scope.environmentId,
      integrationId: scope.integrationId,
      providerKey: scope.providerKey,
      action: "integration_job_succeeded",
      details: JSON.stringify({ jobId: job.id, jobType: job.jobType, attempts: job.attempts }),
      actorUserId: null,
    });
    return updatedJob;
  });
}

export async function markIntegrationJobFailed(
  scope: IntegrationJobScope,
  job: typeof integrationJobsTable.$inferSelect,
  error: unknown,
  options: { retryable?: boolean } = {},
) {
  const failedAt = new Date();
  const safeError = sanitizeIntegrationError(error);
  const deadLetter = job.attempts >= job.maxAttempts;
  const status = deadLetter ? "dead_letter" : options.retryable === false ? "failed" : "retry";
  const nextRetryAt = deadLetter || options.retryable === false
    ? null
    : new Date(failedAt.getTime() + Math.min(15 * 60_000, 30_000 * (2 ** Math.max(0, job.attempts - 1))));

  return db.transaction(async (tx) => {
    const [updatedJob] = await tx.update(integrationJobsTable).set({
      status,
      nextRetryAt,
      lastError: safeError,
      deadLetteredAt: deadLetter ? failedAt : null,
      completedAt: null,
      updatedAt: failedAt,
    }).where(and(
      eq(integrationJobsTable.id, job.id),
      eq(integrationJobsTable.tenantId, scope.tenantId),
      eq(integrationJobsTable.environmentId, scope.environmentId),
      eq(integrationJobsTable.integrationId, scope.integrationId),
      eq(integrationJobsTable.providerKey, scope.providerKey),
    )).returning();
    if (!updatedJob) throw new Error("Integration job is no longer in the active environment");

    await tx.update(integrationsTable).set({
      lastSyncAt: failedAt,
      lastSyncStatus: status,
      lastFailureAt: failedAt,
      lastError: safeError,
      status: deadLetter ? "failed" : "warning",
      updatedAt: failedAt,
    }).where(and(
      eq(integrationsTable.id, scope.integrationId),
      eq(integrationsTable.tenantId, scope.tenantId),
      eq(integrationsTable.environmentId, scope.environmentId),
      eq(integrationsTable.providerKey, scope.providerKey),
    ));

    await tx.insert(integrationAuditEventsTable).values({
      tenantId: scope.tenantId,
      environmentId: scope.environmentId,
      integrationId: scope.integrationId,
      providerKey: scope.providerKey,
      action: deadLetter
        ? "integration_job_dead_lettered"
        : status === "retry"
          ? "integration_job_retry_scheduled"
          : "integration_job_failed",
      details: JSON.stringify({
        jobId: job.id,
        jobType: job.jobType,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        error: safeError,
      }),
      actorUserId: null,
    });
    return updatedJob;
  });
}