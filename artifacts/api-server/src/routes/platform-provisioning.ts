import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  environmentHealthChecksTable,
  environmentRefreshesTable,
  environmentReleaseAssignmentsTable,
  environmentReleaseControlsTable,
  environmentResourcesTable,
  environmentSnapshotsTable,
  environmentsTable,
  provisioningEventsTable,
  provisioningOperationsTable,
} from "@workspace/db";
import {
  ProvisionEnvironmentBody,
  RefreshDtdEnvironmentBody,
  RestoreEnvironmentSnapshotBody,
  VerifyEnvironmentBody,
  VerifyEnvironmentSnapshotBody,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requirePlatformAdmin } from "../middlewares/platformAdmin";
import { logger } from "../lib/logger";
import {
  assertProductionToDtdRefresh,
  assertResourceTransition,
  deriveEnvironmentProvisioningStatus,
  getProvisioningProvider,
  ISOLATED_RESOURCE_TYPES,
  isIsolatedEnvironmentReady,
  isRecentHealthyCheck,
  isRetryableProvisioningProviderError,
  isRuntimeSigningBoundaryReady,
  redactProviderMetadata,
  parseProviderVerificationResult,
} from "../lib/provisioning";

const router: IRouter = Router();
router.use("/platform", requirePlatformAdmin);

const RESTORE_START_LEASE_MS = 60_000;
const SNAPSHOT_PREPARATION_OPERATION_TYPE = "snapshot_prepare" as const;
const RECOVERY_SWEEP_LIMIT = 100;
const RECOVERY_OPERATION_HISTORY_LIMIT = 25;
let recoverySweepCursor = 0;
let terminalRecoverySweepCursor = 0;

class SnapshotPreparationConsistencyError extends Error {}

const parseId = (value: string | string[]) => {
  if (Array.isArray(value)) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

async function environment(id: number) {
  const [row] = await db.select().from(environmentsTable).where(eq(environmentsTable.id, id)).limit(1);
  return row;
}

async function writeEvent(
  actorUserId: number,
  tenantId: number,
  environmentId: number,
  action: string,
  details: Record<string, unknown>,
  resourceId?: number,
  operationId?: number,
) {
  await db.insert(provisioningEventsTable).values({
    tenantId,
    environmentId,
    actorUserId,
    resourceId,
    operationId,
    action,
    details,
  });
}

async function refreshEnvironmentStatus(environmentId: number) {
  const [resourceRows, operationRows] = await Promise.all([
    db.select({
      resourceType: environmentResourcesTable.resourceType,
      status: environmentResourcesTable.status,
    }).from(environmentResourcesTable).where(eq(environmentResourcesTable.environmentId, environmentId)),
    db.select({ status: provisioningOperationsTable.status })
      .from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.environmentId, environmentId)),
  ]);
  const provisioningStatus = deriveEnvironmentProvisioningStatus(resourceRows, operationRows);
  await db.update(environmentsTable).set({
    provisioningStatus,
    ...(provisioningStatus === "ready" ? { provisionedAt: new Date() } : {}),
    updatedAt: new Date(),
  }).where(eq(environmentsTable.id, environmentId));
  return { provisioningStatus, resourceRows, operationRows };
}

async function markRestoreFailure(
  operation: typeof provisioningOperationsTable.$inferSelect,
  message: string,
  expectedLeaseStartedAt?: Date,
  degradeResources = true,
) {
  const details = operation.details ?? {};
  const snapshotId = typeof details.snapshotId === "number" ? details.snapshotId : undefined;
  const refreshId = typeof details.refreshId === "number" ? details.refreshId : undefined;
  const assignmentId = typeof details.assignmentId === "number" ? details.assignmentId : undefined;
  const action = details.releaseRollback
    ? "release_rollback_failed"
    : details.rollback
      ? "rollback_failed"
      : refreshId
        ? "refresh_failed"
        : "restore_failed";
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operation.id)).for("update").limit(1);
    if (!locked || locked.status === "succeeded") return false;
    if (expectedLeaseStartedAt &&
      (locked.status !== "requested" || locked.startedAt?.getTime() !== expectedLeaseStartedAt.getTime())) {
      return false;
    }
    if (locked.status !== "failed") {
      const [failed] = await tx.update(provisioningOperationsTable).set({
        status: "failed",
        error: message,
        completedAt: new Date(),
      }).where(and(
        eq(provisioningOperationsTable.id, locked.id),
        inArray(provisioningOperationsTable.status, ["requested", "running"]),
      )).returning();
      if (!failed) return false;
    }
    const [latestRefreshOperation] = refreshId
      ? await tx.select({ id: provisioningOperationsTable.id }).from(provisioningOperationsTable).where(and(
        eq(provisioningOperationsTable.environmentId, operation.environmentId),
        eq(provisioningOperationsTable.operationType, "refresh"),
        inArray(provisioningOperationsTable.status, ["succeeded", "failed"]),
        sql`${provisioningOperationsTable.details}->>'refreshId' = ${String(refreshId)}`,
      )).orderBy(desc(provisioningOperationsTable.completedAt), desc(provisioningOperationsTable.id)).limit(1)
      : [];
    const ownsRefresh = !refreshId || latestRefreshOperation?.id === operation.id;
    const [latestAssignmentOperation] = assignmentId
      ? await tx.select({ id: provisioningOperationsTable.id }).from(provisioningOperationsTable).where(and(
        eq(provisioningOperationsTable.environmentId, operation.environmentId),
        eq(provisioningOperationsTable.operationType, "rollback"),
        inArray(provisioningOperationsTable.status, ["succeeded", "failed"]),
        sql`${provisioningOperationsTable.details}->>'assignmentId' = ${String(assignmentId)}`,
      )).orderBy(desc(provisioningOperationsTable.completedAt), desc(provisioningOperationsTable.id)).limit(1)
      : [];
    const ownsAssignment = !assignmentId || latestAssignmentOperation?.id === operation.id;
    const [latestEnvironmentOperation] = await tx.select({ id: provisioningOperationsTable.id })
      .from(provisioningOperationsTable).where(and(
        eq(provisioningOperationsTable.environmentId, operation.environmentId),
        inArray(provisioningOperationsTable.operationType, ["restore", "refresh", "rollback"]),
        inArray(provisioningOperationsTable.status, ["succeeded", "failed"]),
      )).orderBy(desc(provisioningOperationsTable.completedAt), desc(provisioningOperationsTable.id)).limit(1);
    if (degradeResources && latestEnvironmentOperation?.id === operation.id) {
      await tx.update(environmentResourcesTable).set({
        status: "degraded",
        lastError: `recovery-operation:${operation.id}:${message}`,
        updatedAt: new Date(),
      }).where(eq(environmentResourcesTable.environmentId, operation.environmentId));
    }
    if (snapshotId && refreshId && ownsRefresh) await tx.update(environmentSnapshotsTable).set({
      status: "failed",
      verificationDetails: { error: message },
    }).where(and(
      eq(environmentSnapshotsTable.id, snapshotId),
      sql`${environmentSnapshotsTable.status} <> 'failed'`,
    ));
    if (refreshId && ownsRefresh) await tx.update(environmentRefreshesTable).set({
      status: "failed",
      error: message,
      completedAt: locked.completedAt ?? new Date(),
    }).where(and(
      eq(environmentRefreshesTable.id, refreshId),
      sql`${environmentRefreshesTable.status} <> 'failed'`,
    ));
    if (assignmentId && ownsAssignment) await tx.update(environmentReleaseControlsTable).set({
      rollbackStatus: "failed",
    }).where(and(
      eq(environmentReleaseControlsTable.assignmentId, assignmentId),
      sql`${environmentReleaseControlsTable.rollbackStatus} <> 'failed'`,
    ));
    const [existingEvent] = await tx.select({ id: provisioningEventsTable.id }).from(provisioningEventsTable).where(and(
      eq(provisioningEventsTable.operationId, operation.id),
      eq(provisioningEventsTable.action, action),
    )).limit(1);
    if (!existingEvent) await tx.insert(provisioningEventsTable).values({
      tenantId: operation.tenantId,
      environmentId: operation.environmentId,
      actorUserId: operation.requestedByUserId,
      operationId: operation.id,
      action,
      details: { operationId: operation.id, snapshotId, refreshId, assignmentId, error: message },
    });
    return true;
  });
}

async function reconcileRestoreOperation(operationId: number) {
  const [operation] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
  if (!operation) return { status: "not_found" as const };
  if (operation.status === "succeeded" || operation.status === "failed") return { status: operation.status as "succeeded" | "failed", operation };
  if (!operation.providerOperationId) return { status: "pending" as const, operation };
  const details = operation.details ?? {};
  let providerStatus;
  try {
    providerStatus = await getProvisioningProvider().getRestoreOperation({
      tenantId: operation.tenantId,
      targetEnvironmentId: operation.environmentId,
      providerOperationId: operation.providerOperationId,
    });
  } catch (error) {
    if (isRetryableProvisioningProviderError(error)) {
      return { status: "pending" as const, operation };
    }
    await markRestoreFailure(operation, error instanceof Error ? error.message : "Restore status polling failed");
    return { status: "failed" as const };
  }
  if (providerStatus.status === "pending") {
    const [running] = await db.update(provisioningOperationsTable).set({ status: "running" })
      .where(and(
        eq(provisioningOperationsTable.id, operation.id),
        inArray(provisioningOperationsTable.status, ["requested", "running"]),
      )).returning();
    if (running) return { status: "pending" as const, operation: running };
    const [current] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operation.id)).limit(1);
    if (current?.status === "succeeded") return { status: "succeeded" as const };
    if (current?.status === "failed") return { status: "failed" as const };
    return { status: "pending" as const, operation: current ?? operation };
  }
  if (providerStatus.status === "failed") {
    await markRestoreFailure(operation, providerStatus.error ?? "Provider restore operation failed");
    return { status: "failed" as const };
  }
  let verification;
  try {
    verification = parseProviderVerificationResult(await getProvisioningProvider().verifyRestoredTarget({
      tenantId: operation.tenantId,
      targetEnvironmentId: operation.environmentId,
      providerOperationId: operation.providerOperationId,
    }));
  } catch (error) {
    if (isRetryableProvisioningProviderError(error)) {
      return { status: "pending" as const, operation };
    }
    await markRestoreFailure(operation, error instanceof Error ? error.message : "Restored target verification failed");
    return { status: "failed" as const };
  }
  const snapshotId = typeof details.snapshotId === "number" ? details.snapshotId : undefined;
  const refreshId = typeof details.refreshId === "number" ? details.refreshId : undefined;
  const assignmentId = typeof details.assignmentId === "number" ? details.assignmentId : undefined;
  const succeeded = await db.transaction(async (tx) => {
    const [completedOperation] = await tx.update(provisioningOperationsTable).set({
      status: "succeeded", completedAt: new Date(),
      details: { ...details, verification },
    }).where(and(
      eq(provisioningOperationsTable.id, operation.id),
      inArray(provisioningOperationsTable.status, ["requested", "running"]),
    )).returning();
    if (!completedOperation) return undefined;
    if (refreshId) await tx.update(environmentRefreshesTable).set({ status: "completed", completedAt: new Date() })
      .where(eq(environmentRefreshesTable.id, refreshId));
    if (assignmentId) await tx.update(environmentReleaseControlsTable).set({ rollbackStatus: "completed", rolledBackAt: new Date() })
      .where(eq(environmentReleaseControlsTable.assignmentId, assignmentId));
    const [latestEnvironmentOperation] = await tx.select({ id: provisioningOperationsTable.id })
      .from(provisioningOperationsTable).where(and(
        eq(provisioningOperationsTable.environmentId, operation.environmentId),
        inArray(provisioningOperationsTable.operationType, ["restore", "refresh", "rollback"]),
        inArray(provisioningOperationsTable.status, ["succeeded", "failed"]),
      )).orderBy(desc(provisioningOperationsTable.completedAt), desc(provisioningOperationsTable.id)).limit(1);
    if (latestEnvironmentOperation?.id === operation.id) {
      await tx.update(environmentResourcesTable).set({
        status: "ready",
        lastError: null,
        updatedAt: new Date(),
      }).where(and(
        eq(environmentResourcesTable.environmentId, operation.environmentId),
        eq(environmentResourcesTable.status, "degraded"),
        sql`${environmentResourcesTable.lastError} LIKE 'recovery-operation:%'`,
      ));
    }
    await tx.insert(provisioningEventsTable).values({
      tenantId: operation.tenantId,
      environmentId: operation.environmentId,
      actorUserId: operation.requestedByUserId,
      operationId: operation.id,
      action: details.rollback ? "rollback_completed" : refreshId ? "refresh_completed" : "restore_completed",
      details: { operationId: operation.id, snapshotId, refreshId, assignmentId },
    });
    return completedOperation;
  });
  if (!succeeded) {
    const [current] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operation.id)).limit(1);
    if (current?.status === "succeeded") return { status: "succeeded" as const };
    if (current?.status === "failed") return { status: "failed" as const };
    return { status: "pending" as const, operation: current ?? operation };
  }
  return { status: "succeeded" as const };
}

async function repairTerminalRestoreOperation(
  operation: typeof provisioningOperationsTable.$inferSelect,
) {
  if (operation.status === "failed") {
    return markRestoreFailure(operation, operation.error ?? "Recovery operation failed", undefined, false);
  }
  if (operation.status !== "succeeded") return false;
  const details = operation.details ?? {};
  const snapshotId = typeof details.snapshotId === "number" ? details.snapshotId : undefined;
  const refreshId = typeof details.refreshId === "number" ? details.refreshId : undefined;
  const assignmentId = typeof details.assignmentId === "number" ? details.assignmentId : undefined;
  const action = details.rollback ? "rollback_completed" : refreshId ? "refresh_completed" : "restore_completed";
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operation.id)).for("update").limit(1);
    if (!locked || locked.status !== "succeeded") return false;
    const [latestRefreshOperation] = refreshId
      ? await tx.select({ id: provisioningOperationsTable.id }).from(provisioningOperationsTable).where(and(
        eq(provisioningOperationsTable.environmentId, operation.environmentId),
        eq(provisioningOperationsTable.operationType, "refresh"),
        inArray(provisioningOperationsTable.status, ["succeeded", "failed"]),
        sql`${provisioningOperationsTable.details}->>'refreshId' = ${String(refreshId)}`,
      )).orderBy(desc(provisioningOperationsTable.completedAt), desc(provisioningOperationsTable.id)).limit(1)
      : [];
    const ownsRefresh = !refreshId || latestRefreshOperation?.id === operation.id;
    const [latestAssignmentOperation] = assignmentId
      ? await tx.select({ id: provisioningOperationsTable.id }).from(provisioningOperationsTable).where(and(
        eq(provisioningOperationsTable.environmentId, operation.environmentId),
        eq(provisioningOperationsTable.operationType, "rollback"),
        inArray(provisioningOperationsTable.status, ["succeeded", "failed"]),
        sql`${provisioningOperationsTable.details}->>'assignmentId' = ${String(assignmentId)}`,
      )).orderBy(desc(provisioningOperationsTable.completedAt), desc(provisioningOperationsTable.id)).limit(1)
      : [];
    const ownsAssignment = !assignmentId || latestAssignmentOperation?.id === operation.id;
    const [latestEnvironmentOperation] = await tx.select({ id: provisioningOperationsTable.id })
      .from(provisioningOperationsTable).where(and(
        eq(provisioningOperationsTable.environmentId, operation.environmentId),
        inArray(provisioningOperationsTable.operationType, ["restore", "refresh", "rollback"]),
        inArray(provisioningOperationsTable.status, ["succeeded", "failed"]),
      )).orderBy(desc(provisioningOperationsTable.completedAt), desc(provisioningOperationsTable.id)).limit(1);
    if (latestEnvironmentOperation?.id === operation.id) {
      await tx.update(environmentResourcesTable).set({
        status: "ready",
        lastError: null,
        updatedAt: new Date(),
      }).where(and(
        eq(environmentResourcesTable.environmentId, operation.environmentId),
        eq(environmentResourcesTable.status, "degraded"),
        sql`${environmentResourcesTable.lastError} LIKE 'recovery-operation:%'`,
      ));
    }
    if (refreshId && ownsRefresh) await tx.update(environmentRefreshesTable).set({
      status: "completed",
      completedAt: locked.completedAt ?? new Date(),
    }).where(and(
      eq(environmentRefreshesTable.id, refreshId),
      sql`${environmentRefreshesTable.status} <> 'completed'`,
    ));
    if (assignmentId && ownsAssignment) await tx.update(environmentReleaseControlsTable).set({
      rollbackStatus: "completed",
      rolledBackAt: locked.completedAt ?? new Date(),
    }).where(and(
      eq(environmentReleaseControlsTable.assignmentId, assignmentId),
      sql`${environmentReleaseControlsTable.rollbackStatus} <> 'completed'`,
    ));
    const [existingEvent] = await tx.select({ id: provisioningEventsTable.id }).from(provisioningEventsTable).where(and(
      eq(provisioningEventsTable.operationId, operation.id),
      eq(provisioningEventsTable.action, action),
    )).limit(1);
    if (!existingEvent) await tx.insert(provisioningEventsTable).values({
      tenantId: operation.tenantId,
      environmentId: operation.environmentId,
      actorUserId: operation.requestedByUserId,
      operationId: operation.id,
      action,
      details: { operationId: operation.id, snapshotId, refreshId, assignmentId },
    });
    return true;
  });
}

type RestoreOperationClaim = {
  tenantId: number;
  environmentId: number;
  requestedByUserId?: number;
  operationType: "restore" | "refresh" | "rollback" | typeof SNAPSHOT_PREPARATION_OPERATION_TYPE;
  idempotencyKey: string;
  details: Record<string, unknown>;
};

/**
 * The operation row is the recovery claim. It must be created before the
 * provider is called: an idempotency-key collision therefore cannot result in
 * a second destructive provider request.
 */
async function claimRestoreOperation(input: RestoreOperationClaim) {
  const [operation] = await db.insert(provisioningOperationsTable).values({
    tenantId: input.tenantId,
    environmentId: input.environmentId,
    operationType: input.operationType,
    idempotencyKey: input.idempotencyKey,
    status: "requested",
    details: input.details,
    requestedByUserId: input.requestedByUserId,
  }).onConflictDoNothing({
    target: [
      provisioningOperationsTable.environmentId,
      provisioningOperationsTable.operationType,
      provisioningOperationsTable.idempotencyKey,
    ],
  }).returning();
  if (operation) return { kind: "claimed" as const, operation };
  const [existing] = await db.select().from(provisioningOperationsTable).where(and(
    eq(provisioningOperationsTable.environmentId, input.environmentId),
    eq(provisioningOperationsTable.operationType, input.operationType),
    eq(provisioningOperationsTable.idempotencyKey, input.idempotencyKey),
  )).limit(1);
  if (!existing) throw new Error("Restore operation could not be recorded");
  const existingDetails = existing.details ?? {};
  const requestedSnapshotId = input.details.snapshotId;
  const existingSnapshotId = existingDetails.snapshotId;
  if (typeof requestedSnapshotId !== "number" || existingSnapshotId !== requestedSnapshotId) {
    return {
      kind: "conflict" as const,
      operation: existing,
      error: "Idempotency key is already associated with a different snapshot",
    };
  }
  const requestedAssignmentId = input.details.assignmentId;
  const existingAssignmentId = existingDetails.assignmentId;
  if ((requestedAssignmentId !== undefined || existingAssignmentId !== undefined) &&
    requestedAssignmentId !== existingAssignmentId) {
    return {
      kind: "conflict" as const,
      operation: existing,
      error: "Idempotency key is already associated with a different release assignment",
    };
  }
  const requestedSourceEnvironmentId = input.details.sourceEnvironmentId;
  const existingSourceEnvironmentId = existingDetails.sourceEnvironmentId;
  if ((requestedSourceEnvironmentId !== undefined || existingSourceEnvironmentId !== undefined) &&
    requestedSourceEnvironmentId !== existingSourceEnvironmentId) {
    return {
      kind: "conflict" as const,
      operation: existing,
      error: "Idempotency key is already associated with a different source environment",
    };
  }
  const requestedSanitizationPolicy = input.details.sanitizationPolicy;
  const existingSanitizationPolicy = existingDetails.sanitizationPolicy;
  if ((requestedSanitizationPolicy !== undefined || existingSanitizationPolicy !== undefined) &&
    requestedSanitizationPolicy !== existingSanitizationPolicy) {
    return {
      kind: "conflict" as const,
      operation: existing,
      error: "Idempotency key is already associated with a different sanitization policy",
    };
  }
  return { kind: "existing" as const, operation: existing };
}

function refreshSnapshotValidationError(input: {
  refresh: typeof environmentRefreshesTable.$inferSelect;
  snapshot: typeof environmentSnapshotsTable.$inferSelect;
  sourceEnvironmentId: number;
  sanitizationPolicy: string;
  requireVerified?: boolean;
}) {
  const { refresh, snapshot } = input;
  if (refresh.snapshotId !== snapshot.id) return "Refresh snapshot linkage is invalid";
  if (snapshot.kind !== "refresh") return "Refresh requires a refresh snapshot";
  if (snapshot.tenantId !== refresh.tenantId ||
    snapshot.environmentId !== refresh.targetEnvironmentId ||
    refresh.sourceEnvironmentId !== input.sourceEnvironmentId ||
    snapshot.sourceEnvironmentId !== input.sourceEnvironmentId) {
    return "Refresh snapshot tenant, environment, or source linkage is invalid";
  }
  if (refresh.sanitizationPolicy !== input.sanitizationPolicy ||
    snapshot.sanitizationPolicy !== input.sanitizationPolicy) {
    return "Refresh snapshot sanitization policy does not match the requested policy";
  }
  if (input.requireVerified) {
    const details = snapshot.verificationDetails ?? {};
    if (snapshot.status !== "verified" || snapshot.sanitized !== "sanitized" ||
      details.sanitized !== true || details.sanitizationPolicy !== input.sanitizationPolicy) {
      return "Refresh snapshot verification did not explicitly confirm sanitization and the requested policy";
    }
  }
  return undefined;
}

async function markSnapshotPreparationFailure(
  operation: typeof provisioningOperationsTable.$inferSelect,
  message: string,
  expectedLeaseStartedAt?: Date,
) {
  const details = operation.details ?? {};
  const snapshotId = typeof details.snapshotId === "number" ? details.snapshotId : undefined;
  const refreshId = typeof details.refreshId === "number" ? details.refreshId : undefined;
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operation.id)).for("update").limit(1);
    if (!locked || locked.status === "succeeded") return false;
    if (expectedLeaseStartedAt &&
      (locked.status !== "running" || locked.startedAt?.getTime() !== expectedLeaseStartedAt.getTime())) {
      return false;
    }
    if (locked.status !== "failed") {
      const [failed] = await tx.update(provisioningOperationsTable).set({
        status: "failed",
        error: message,
        completedAt: new Date(),
      }).where(and(
        eq(provisioningOperationsTable.id, locked.id),
        inArray(provisioningOperationsTable.status, ["requested", "running"]),
      )).returning();
      if (!failed) return false;
    }
    if (snapshotId) await tx.update(environmentSnapshotsTable).set({
      status: "failed",
      verificationDetails: { verified: false, error: message },
    }).where(and(
      eq(environmentSnapshotsTable.id, snapshotId),
      sql`${environmentSnapshotsTable.status} <> 'failed'`,
    ));
    if (refreshId) await tx.update(environmentRefreshesTable).set({
      status: "failed",
      error: message,
      completedAt: locked.completedAt ?? new Date(),
    }).where(and(
      eq(environmentRefreshesTable.id, refreshId),
      sql`${environmentRefreshesTable.status} <> 'failed'`,
    ));
    const [existingEvent] = await tx.select({ id: provisioningEventsTable.id }).from(provisioningEventsTable).where(and(
      eq(provisioningEventsTable.operationId, operation.id),
      eq(provisioningEventsTable.action, "refresh_failed"),
    )).limit(1);
    if (!existingEvent) await tx.insert(provisioningEventsTable).values({
      tenantId: operation.tenantId,
      environmentId: operation.environmentId,
      actorUserId: operation.requestedByUserId,
      operationId: operation.id,
      action: "refresh_failed",
      details: { operationId: operation.id, snapshotId, refreshId, error: message },
    });
    return true;
  });
}

async function markRefreshValidationFailure(
  refresh: typeof environmentRefreshesTable.$inferSelect,
  snapshot: typeof environmentSnapshotsTable.$inferSelect,
  message: string,
  actorUserId?: number,
) {
  return db.transaction(async (tx) => {
    const [lockedRefresh] = await tx.select().from(environmentRefreshesTable)
      .where(eq(environmentRefreshesTable.id, refresh.id)).for("update").limit(1);
    if (!lockedRefresh) return false;
    if (lockedRefresh.status !== "failed") {
      await tx.update(environmentRefreshesTable).set({
        status: "failed",
        error: message,
        completedAt: new Date(),
      }).where(eq(environmentRefreshesTable.id, refresh.id));
    }
    // Never corrupt a normal backup merely because a refresh idempotency key
    // collided with it. A refresh-owned snapshot, however, is terminally bad.
    if (snapshot.kind === "refresh" &&
      snapshot.tenantId === refresh.tenantId &&
      snapshot.environmentId === refresh.targetEnvironmentId &&
      snapshot.status !== "failed") {
      await tx.update(environmentSnapshotsTable).set({
        status: "failed",
        verificationDetails: { verified: false, error: message },
      }).where(eq(environmentSnapshotsTable.id, snapshot.id));
    }
    const [existingEvent] = await tx.select({ id: provisioningEventsTable.id }).from(provisioningEventsTable).where(and(
      eq(provisioningEventsTable.environmentId, refresh.targetEnvironmentId),
      eq(provisioningEventsTable.action, "refresh_failed"),
      eq(provisioningEventsTable.details, {
        refreshId: refresh.id,
        snapshotId: snapshot.id,
        error: message,
      }),
    )).limit(1);
    if (!existingEvent) await tx.insert(provisioningEventsTable).values({
      tenantId: refresh.tenantId,
      environmentId: refresh.targetEnvironmentId,
      actorUserId,
      action: "refresh_failed",
      details: { refreshId: refresh.id, snapshotId: snapshot.id, error: message },
    });
    return true;
  });
}

type SnapshotPreparationStartResult =
  | { kind: "started"; operation: typeof provisioningOperationsTable.$inferSelect }
  | { kind: "busy"; operation: typeof provisioningOperationsTable.$inferSelect }
  | { kind: "failed"; operation: typeof provisioningOperationsTable.$inferSelect; error: string }
  | { kind: "lease_lost"; operation: typeof provisioningOperationsTable.$inferSelect };

async function startSnapshotPreparationOperation(operationId: number): Promise<SnapshotPreparationStartResult> {
  const [current] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
  if (!current) throw new Error("Snapshot preparation operation not found");
  if (current.operationType !== SNAPSHOT_PREPARATION_OPERATION_TYPE) {
    throw new Error("Operation is not a snapshot preparation operation");
  }
  if (current.status === "succeeded" || current.status === "failed") {
    if (current.status === "failed") {
      return { kind: "failed", operation: current, error: current.error ?? "Snapshot preparation failed" };
    }
    return { kind: "started", operation: current };
  }
  const leaseStartedAt = new Date();
  const staleBefore = new Date(leaseStartedAt.getTime() - RESTORE_START_LEASE_MS);
  const [leased] = await db.update(provisioningOperationsTable).set({
    status: "running",
    startedAt: leaseStartedAt,
  }).where(and(
    eq(provisioningOperationsTable.id, operationId),
    inArray(provisioningOperationsTable.status, ["requested", "running"]),
    or(isNull(provisioningOperationsTable.startedAt), lt(provisioningOperationsTable.startedAt, staleBefore)),
  )).returning();
  if (!leased) {
    const [operation] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
    if (!operation) throw new Error("Snapshot preparation operation not found");
    return { kind: "busy", operation };
  }

  const details = leased.details ?? {};
  const snapshotId = typeof details.snapshotId === "number" ? details.snapshotId : undefined;
  const refreshId = typeof details.refreshId === "number" ? details.refreshId : undefined;
  const sourceEnvironmentId = typeof details.sourceEnvironmentId === "number" ? details.sourceEnvironmentId : undefined;
  const sanitizationPolicy = typeof details.sanitizationPolicy === "string" ? details.sanitizationPolicy : undefined;
  const [snapshot] = snapshotId
    ? await db.select().from(environmentSnapshotsTable).where(and(
      eq(environmentSnapshotsTable.id, snapshotId),
      eq(environmentSnapshotsTable.tenantId, leased.tenantId),
      eq(environmentSnapshotsTable.environmentId, leased.environmentId),
    )).limit(1)
    : [];
  const [refresh] = refreshId
    ? await db.select().from(environmentRefreshesTable).where(and(
      eq(environmentRefreshesTable.id, refreshId),
      eq(environmentRefreshesTable.tenantId, leased.tenantId),
      eq(environmentRefreshesTable.targetEnvironmentId, leased.environmentId),
    )).limit(1)
    : [];
  const validationError = !snapshot || !refresh || sourceEnvironmentId === undefined || !sanitizationPolicy
    ? "Snapshot preparation operation has incomplete durable details"
    : refreshSnapshotValidationError({
      refresh,
      snapshot,
      sourceEnvironmentId,
      sanitizationPolicy,
    });
  if (validationError) {
    const marked = await markSnapshotPreparationFailure(leased, validationError, leaseStartedAt);
    const [failed] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
    if (!marked) return { kind: "lease_lost", operation: failed ?? leased };
    return { kind: "failed", operation: failed ?? leased, error: validationError };
  }

  const provider = getProvisioningProvider();
  let result: Awaited<ReturnType<typeof provider.createSnapshot>>;
  let verificationDetails: ReturnType<typeof parseProviderVerificationResult>;
  try {
    result = await provider.createSnapshot({
      tenantId: leased.tenantId,
      sourceEnvironmentId: sourceEnvironmentId!,
      targetEnvironmentId: leased.environmentId,
      sanitized: true,
      sanitizationPolicy: sanitizationPolicy as "redact-secrets" | "replace-identifiers" | "full",
      idempotencyKey: leased.idempotencyKey,
    });
    verificationDetails = parseProviderVerificationResult(await provider.verifySnapshot({
      tenantId: leased.tenantId,
      environmentId: leased.environmentId,
      backupReference: result.backupReference,
      checksum: result.checksum,
      idempotencyKey: `${leased.idempotencyKey}:verify`,
    }));
    if (verificationDetails.sanitized !== true ||
      verificationDetails.sanitizationPolicy !== sanitizationPolicy) {
      throw new Error("Refresh snapshot verification did not explicitly confirm sanitization and the requested policy");
    }
  } catch (error) {
    if (isRetryableProvisioningProviderError(error)) {
      return { kind: "busy", operation: leased };
    }
    const message = error instanceof Error ? error.message : "Snapshot preparation failed";
    const marked = await markSnapshotPreparationFailure(leased, message, leaseStartedAt);
    const [failed] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
    if (!marked) return { kind: "lease_lost", operation: failed ?? leased };
    return { kind: "failed", operation: failed ?? leased, error: message };
  }

  let completed;
  try {
    completed = await db.transaction(async (tx) => {
      const [completedOperation] = await tx.update(provisioningOperationsTable).set({
        status: "succeeded",
        providerOperationId: result.providerOperationId,
        completedAt: new Date(),
      }).where(and(
        eq(provisioningOperationsTable.id, leased.id),
        eq(provisioningOperationsTable.status, "running"),
        eq(provisioningOperationsTable.startedAt, leaseStartedAt),
      )).returning();
      if (!completedOperation) return { operation: undefined, snapshot: undefined };
      const [completedSnapshot] = await tx.update(environmentSnapshotsTable).set({
        status: "verified",
        sanitized: "sanitized",
        backupReference: result.backupReference,
        checksum: result.checksum,
        verificationDetails,
        verifiedAt: new Date(),
      }).where(and(
        eq(environmentSnapshotsTable.id, snapshot!.id),
        inArray(environmentSnapshotsTable.status, ["requested", "running"]),
      )).returning();
      if (!completedSnapshot) {
        throw new SnapshotPreparationConsistencyError("Refresh snapshot status changed during provider preparation");
      }
      const restoreDetails = {
        refreshId: refresh!.id,
        snapshotId: snapshot!.id,
        sourceEnvironmentId,
        sanitizationPolicy,
      };
      const [insertedRestoreOperation] = await tx.insert(provisioningOperationsTable).values({
        tenantId: leased.tenantId,
        environmentId: leased.environmentId,
        operationType: "refresh",
        idempotencyKey: `${leased.idempotencyKey}:restore`,
        status: "requested",
        details: restoreDetails,
        requestedByUserId: leased.requestedByUserId,
      }).onConflictDoNothing({
        target: [
          provisioningOperationsTable.environmentId,
          provisioningOperationsTable.operationType,
          provisioningOperationsTable.idempotencyKey,
        ],
      }).returning();
      const restoreOperation = insertedRestoreOperation ?? (await tx.select()
        .from(provisioningOperationsTable)
        .where(and(
          eq(provisioningOperationsTable.environmentId, leased.environmentId),
          eq(provisioningOperationsTable.operationType, "refresh"),
          eq(provisioningOperationsTable.idempotencyKey, `${leased.idempotencyKey}:restore`),
        ))
        .limit(1))[0];
      const existingDetails = restoreOperation?.details ?? {};
      if (!restoreOperation ||
        existingDetails.refreshId !== restoreDetails.refreshId ||
        existingDetails.snapshotId !== restoreDetails.snapshotId ||
        existingDetails.sourceEnvironmentId !== restoreDetails.sourceEnvironmentId ||
        existingDetails.sanitizationPolicy !== restoreDetails.sanitizationPolicy) {
        throw new SnapshotPreparationConsistencyError("Refresh restore claim conflicts with the completed snapshot preparation");
      }
      await tx.insert(provisioningEventsTable).values({
        tenantId: leased.tenantId,
        environmentId: leased.environmentId,
        actorUserId: leased.requestedByUserId,
        operationId: leased.id,
        action: "snapshot_preparation_completed",
        details: { operationId: leased.id, snapshotId: snapshot!.id, refreshId: refresh!.id },
      });
      return { snapshot: completedSnapshot, operation: completedOperation };
    });
  } catch (error) {
    if (!(error instanceof SnapshotPreparationConsistencyError)) {
      // Provider work is idempotent and may already have succeeded. Preserve
      // the lease for stale replay when local persistence fails.
      return { kind: "busy", operation: leased };
    }
    const message = error instanceof Error ? error.message : "Snapshot preparation failed";
    const marked = await markSnapshotPreparationFailure(leased, message, leaseStartedAt);
    const [failed] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
    if (!marked) return { kind: "lease_lost", operation: failed ?? leased };
    return { kind: "failed", operation: failed ?? leased, error: message };
  }
  if (!completed.operation) {
    const [operation] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
    return { kind: "lease_lost", operation: operation ?? leased };
  }
  return { kind: "started", operation: completed.operation };
}

async function reconcileSnapshotPreparationOperation(operationId: number) {
  const [operation] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
  if (!operation) return { status: "not_found" as const };
  if (operation.operationType !== SNAPSHOT_PREPARATION_OPERATION_TYPE) {
    return { status: "not_found" as const };
  }
  if (operation.status === "succeeded") return { status: "succeeded" as const, operation };
  if (operation.status === "failed") return { status: "failed" as const, operation };
  const started = await startSnapshotPreparationOperation(operation.id);
  if (started.kind === "busy" || started.kind === "lease_lost") {
    return { status: "pending" as const, operation: started.operation };
  }
  if (started.kind === "failed") return { status: "failed" as const, operation: started.operation };
  return { status: "succeeded" as const, operation: started.operation };
}

async function prepareRefreshSnapshot(input: {
  refresh: typeof environmentRefreshesTable.$inferSelect;
  snapshot: typeof environmentSnapshotsTable.$inferSelect;
  sourceEnvironmentId: number;
  sanitizationPolicy: string;
  requestedByUserId?: number;
}) {
  const structuralError = refreshSnapshotValidationError(input);
  if (structuralError) {
    await markRefreshValidationFailure(input.refresh, input.snapshot, structuralError, input.requestedByUserId);
    const [refresh] = await db.select().from(environmentRefreshesTable)
      .where(eq(environmentRefreshesTable.id, input.refresh.id)).limit(1);
    return { status: "conflict" as const, error: structuralError, refresh: refresh ?? input.refresh, snapshot: input.snapshot };
  }
  let operation = (await db.select().from(provisioningOperationsTable).where(and(
    eq(provisioningOperationsTable.environmentId, input.refresh.targetEnvironmentId),
    eq(provisioningOperationsTable.operationType, SNAPSHOT_PREPARATION_OPERATION_TYPE),
    eq(provisioningOperationsTable.idempotencyKey, input.refresh.idempotencyKey),
  )).limit(1))[0];
  if (!operation && input.snapshot.status === "verified") {
    operation = await db.transaction(async (tx) => {
      const preparationDetails = {
        refreshId: input.refresh.id,
        snapshotId: input.snapshot.id,
        sourceEnvironmentId: input.sourceEnvironmentId,
        sanitizationPolicy: input.sanitizationPolicy,
        recoveredFromVerifiedSnapshot: true,
      };
      const [insertedPreparation] = await tx.insert(provisioningOperationsTable).values({
        tenantId: input.refresh.tenantId,
        environmentId: input.refresh.targetEnvironmentId,
        operationType: SNAPSHOT_PREPARATION_OPERATION_TYPE,
        idempotencyKey: input.refresh.idempotencyKey,
        status: "succeeded",
        details: preparationDetails,
        requestedByUserId: input.requestedByUserId,
        completedAt: new Date(),
      }).onConflictDoNothing({
        target: [
          provisioningOperationsTable.environmentId,
          provisioningOperationsTable.operationType,
          provisioningOperationsTable.idempotencyKey,
        ],
      }).returning();
      let preparation = insertedPreparation ?? (await tx.select().from(provisioningOperationsTable).where(and(
        eq(provisioningOperationsTable.environmentId, input.refresh.targetEnvironmentId),
        eq(provisioningOperationsTable.operationType, SNAPSHOT_PREPARATION_OPERATION_TYPE),
        eq(provisioningOperationsTable.idempotencyKey, input.refresh.idempotencyKey),
      )).limit(1))[0];
      if (!preparation) throw new Error("Recovered snapshot preparation claim could not be recorded");
      if (preparation.status === "requested" || preparation.status === "running") {
        const [completedPreparation] = await tx.update(provisioningOperationsTable).set({
          status: "succeeded",
          details: preparationDetails,
          completedAt: new Date(),
        }).where(and(
          eq(provisioningOperationsTable.id, preparation.id),
          inArray(provisioningOperationsTable.status, ["requested", "running"]),
        )).returning();
        preparation = completedPreparation ?? preparation;
      }
      if (preparation.status !== "succeeded") return preparation;
      const existingPreparationDetails = preparation.details ?? {};
      if (existingPreparationDetails.refreshId !== input.refresh.id ||
        existingPreparationDetails.snapshotId !== input.snapshot.id ||
        existingPreparationDetails.sourceEnvironmentId !== input.sourceEnvironmentId ||
        existingPreparationDetails.sanitizationPolicy !== input.sanitizationPolicy) {
        throw new Error("Recovered snapshot preparation claim conflicts with the verified refresh snapshot");
      }
      const restoreDetails = {
        refreshId: input.refresh.id,
        snapshotId: input.snapshot.id,
        sourceEnvironmentId: input.sourceEnvironmentId,
        sanitizationPolicy: input.sanitizationPolicy,
      };
      const [insertedRestore] = await tx.insert(provisioningOperationsTable).values({
        tenantId: input.refresh.tenantId,
        environmentId: input.refresh.targetEnvironmentId,
        operationType: "refresh",
        idempotencyKey: `${input.refresh.idempotencyKey}:restore`,
        status: "requested",
        details: restoreDetails,
        requestedByUserId: input.requestedByUserId,
      }).onConflictDoNothing({
        target: [
          provisioningOperationsTable.environmentId,
          provisioningOperationsTable.operationType,
          provisioningOperationsTable.idempotencyKey,
        ],
      }).returning();
      const restore = insertedRestore ?? (await tx.select().from(provisioningOperationsTable).where(and(
        eq(provisioningOperationsTable.environmentId, input.refresh.targetEnvironmentId),
        eq(provisioningOperationsTable.operationType, "refresh"),
        eq(provisioningOperationsTable.idempotencyKey, `${input.refresh.idempotencyKey}:restore`),
      )).limit(1))[0];
      const existingRestoreDetails = restore?.details ?? {};
      if (!restore ||
        existingRestoreDetails.refreshId !== restoreDetails.refreshId ||
        existingRestoreDetails.snapshotId !== restoreDetails.snapshotId ||
        existingRestoreDetails.sourceEnvironmentId !== restoreDetails.sourceEnvironmentId ||
        existingRestoreDetails.sanitizationPolicy !== restoreDetails.sanitizationPolicy) {
        throw new Error("Recovered refresh restore claim conflicts with the verified snapshot");
      }
      return preparation;
    });
  }
  if (!operation) {
    const claim = await db.insert(provisioningOperationsTable).values({
      tenantId: input.refresh.tenantId,
      environmentId: input.refresh.targetEnvironmentId,
      operationType: SNAPSHOT_PREPARATION_OPERATION_TYPE,
      idempotencyKey: input.refresh.idempotencyKey,
      status: "requested",
      details: {
        refreshId: input.refresh.id,
        snapshotId: input.snapshot.id,
        sourceEnvironmentId: input.sourceEnvironmentId,
        sanitizationPolicy: input.sanitizationPolicy,
      },
      requestedByUserId: input.requestedByUserId,
    }).onConflictDoNothing({
      target: [
        provisioningOperationsTable.environmentId,
        provisioningOperationsTable.operationType,
        provisioningOperationsTable.idempotencyKey,
      ],
    }).returning();
    operation = claim[0] ?? (await db.select().from(provisioningOperationsTable).where(and(
      eq(provisioningOperationsTable.environmentId, input.refresh.targetEnvironmentId),
      eq(provisioningOperationsTable.operationType, SNAPSHOT_PREPARATION_OPERATION_TYPE),
      eq(provisioningOperationsTable.idempotencyKey, input.refresh.idempotencyKey),
    )).limit(1))[0];
  }
  if (!operation) return { status: "failed" as const, error: "Snapshot preparation operation could not be claimed", refresh: input.refresh, snapshot: input.snapshot };
  if (input.refresh.status === "failed" || input.snapshot.status === "failed") {
    if (operation.status === "requested" || operation.status === "running") {
      await markSnapshotPreparationFailure(
        operation,
        input.refresh.error ?? "Refresh failed",
      );
    }
    return {
      status: "failed" as const,
      error: input.refresh.error ?? operation.error ?? "Refresh failed",
      refresh: input.refresh,
      snapshot: input.snapshot,
      operation,
    };
  }
  if (operation.status === "succeeded") {
    const verifiedError = refreshSnapshotValidationError({ ...input, requireVerified: true });
    if (verifiedError) {
      await markRefreshValidationFailure(input.refresh, input.snapshot, verifiedError, input.requestedByUserId);
      const [refresh] = await db.select().from(environmentRefreshesTable)
        .where(eq(environmentRefreshesTable.id, input.refresh.id)).limit(1);
      return { status: "conflict" as const, error: verifiedError, refresh: refresh ?? input.refresh, snapshot: input.snapshot, operation };
    }
    return { status: "succeeded" as const, refresh: input.refresh, snapshot: input.snapshot, operation };
  }
  const reconciled = await reconcileSnapshotPreparationOperation(operation.id);
  const [refresh] = await db.select().from(environmentRefreshesTable).where(eq(environmentRefreshesTable.id, input.refresh.id)).limit(1);
  const [snapshot] = await db.select().from(environmentSnapshotsTable).where(eq(environmentSnapshotsTable.id, input.snapshot.id)).limit(1);
  return {
    status: reconciled.status === "succeeded" ? "succeeded" as const : reconciled.status === "failed" ? "failed" as const : "pending" as const,
    error: reconciled.status === "failed" ? reconciled.operation?.error : undefined,
    refresh: refresh ?? input.refresh,
    snapshot: snapshot ?? input.snapshot,
    operation: reconciled.operation ?? operation,
  };
}

async function resumeRefreshOperation(input: {
  refresh: typeof environmentRefreshesTable.$inferSelect;
  snapshot: typeof environmentSnapshotsTable.$inferSelect;
  sourceEnvironmentId: number;
  sanitizationPolicy: string;
  requestedByUserId?: number;
}) {
  const preparation = await prepareRefreshSnapshot(input);
  if (preparation.status !== "succeeded") return preparation;
  const refresh = preparation.refresh;
  const snapshot = preparation.snapshot;
  const restoreValidationError = refreshSnapshotValidationError({
    refresh,
    snapshot,
    sourceEnvironmentId: input.sourceEnvironmentId,
    sanitizationPolicy: input.sanitizationPolicy,
    requireVerified: true,
  });
  if (restoreValidationError) {
    await markRefreshValidationFailure(refresh, snapshot, restoreValidationError, input.requestedByUserId);
    return { status: "conflict" as const, error: restoreValidationError, refresh, snapshot };
  }
  let operation = (await db.select().from(provisioningOperationsTable).where(and(
    eq(provisioningOperationsTable.environmentId, refresh.targetEnvironmentId),
    eq(provisioningOperationsTable.operationType, "refresh"),
    eq(provisioningOperationsTable.idempotencyKey, `${refresh.idempotencyKey}:restore`),
  )).limit(1))[0];

  if (!operation) {
    const claim = await claimRestoreOperation({
      tenantId: refresh.tenantId,
      environmentId: refresh.targetEnvironmentId,
      requestedByUserId: input.requestedByUserId,
      operationType: "refresh",
      idempotencyKey: `${refresh.idempotencyKey}:restore`,
      details: {
        refreshId: refresh.id,
        snapshotId: snapshot.id,
        sourceEnvironmentId: input.sourceEnvironmentId,
        sanitizationPolicy: input.sanitizationPolicy,
      },
    });
    if (claim.kind === "conflict") {
      return { status: "failed" as const, refresh, snapshot, operation: claim.operation };
    }
    operation = claim.operation;
  }

  if (operation.status === "requested") {
    const started = await startRestoreOperation(operation.id);
    if (started.kind === "failed") {
      const [refresh] = await db.select().from(environmentRefreshesTable)
        .where(eq(environmentRefreshesTable.id, input.refresh.id)).limit(1);
      const [snapshot] = await db.select().from(environmentSnapshotsTable)
        .where(eq(environmentSnapshotsTable.id, input.snapshot.id)).limit(1);
      return {
        status: "failed" as const,
        refresh: refresh ?? input.refresh,
        snapshot: snapshot ?? input.snapshot,
        operation: started.operation,
      };
    }
    operation = started.operation;
  }

  const reconciled = await reconcileRestoreOperation(operation.id);
  const [latestRefresh] = await db.select().from(environmentRefreshesTable)
    .where(eq(environmentRefreshesTable.id, input.refresh.id)).limit(1);
  const [latestSnapshot] = await db.select().from(environmentSnapshotsTable)
    .where(eq(environmentSnapshotsTable.id, input.snapshot.id)).limit(1);
  const [updatedOperation] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, operation.id)).limit(1);
  return {
    status: reconciled.status,
    refresh: latestRefresh ?? input.refresh,
    snapshot: latestSnapshot ?? input.snapshot,
    operation: updatedOperation ?? operation,
  };
}

type RestoreStartResult =
  | { kind: "started"; operation: typeof provisioningOperationsTable.$inferSelect }
  | { kind: "busy"; operation: typeof provisioningOperationsTable.$inferSelect }
  | { kind: "failed"; operation: typeof provisioningOperationsTable.$inferSelect; error: string }
  | { kind: "lease_lost"; operation: typeof provisioningOperationsTable.$inferSelect };

/**
 * Acquire the DB-backed start lease and resume the provider request. The
 * provider idempotency key is the persisted operation key so a process crash
 * between provider acceptance and our update is safe to replay.
 */
export async function startRestoreOperation(operationId: number): Promise<RestoreStartResult> {
  const [current] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
  if (!current) throw new Error("Restore operation not found");
  if (current.status !== "requested") return { kind: "busy", operation: current };

  const leaseStartedAt = new Date();
  const staleBefore = new Date(leaseStartedAt.getTime() - RESTORE_START_LEASE_MS);
  const [leased] = await db.update(provisioningOperationsTable).set({
    startedAt: leaseStartedAt,
  }).where(and(
    eq(provisioningOperationsTable.id, operationId),
    eq(provisioningOperationsTable.status, "requested"),
    or(isNull(provisioningOperationsTable.startedAt), lt(provisioningOperationsTable.startedAt, staleBefore)),
  )).returning();
  if (!leased) {
    const [operation] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
    if (!operation) throw new Error("Restore operation not found");
    return { kind: "busy", operation };
  }

  const details = leased.details ?? {};
  const snapshotId = typeof details.snapshotId === "number" ? details.snapshotId : undefined;
  const [snapshot] = snapshotId
    ? await db.select().from(environmentSnapshotsTable).where(and(
      eq(environmentSnapshotsTable.id, snapshotId),
      eq(environmentSnapshotsTable.tenantId, leased.tenantId),
      eq(environmentSnapshotsTable.environmentId, leased.environmentId),
    )).limit(1)
    : [];
  let startupError = !snapshot
    ? "Restore operation has no matching snapshot"
    : snapshot.status !== "verified" || !snapshot.backupReference
      ? "Restore operation requires a verified snapshot with a backup reference"
      : undefined;
  if (!startupError && leased.operationType === "refresh") {
    const refreshId = typeof details.refreshId === "number" ? details.refreshId : undefined;
    const sourceEnvironmentId = typeof details.sourceEnvironmentId === "number" ? details.sourceEnvironmentId : undefined;
    const sanitizationPolicy = typeof details.sanitizationPolicy === "string" ? details.sanitizationPolicy : undefined;
    const [refresh] = refreshId
      ? await db.select().from(environmentRefreshesTable).where(and(
        eq(environmentRefreshesTable.id, refreshId),
        eq(environmentRefreshesTable.tenantId, leased.tenantId),
        eq(environmentRefreshesTable.targetEnvironmentId, leased.environmentId),
      )).limit(1)
      : [];
    startupError = !refresh || sourceEnvironmentId === undefined || !sanitizationPolicy
      ? "Refresh restore operation has incomplete durable details"
      : refreshSnapshotValidationError({
        refresh,
        snapshot: snapshot!,
        sourceEnvironmentId,
        sanitizationPolicy,
        requireVerified: true,
      });
  }
  if (startupError || !snapshot || !snapshot.backupReference) {
    const error = startupError ?? "Restore operation requires a verified snapshot with a backup reference";
    const marked = await markRestoreFailure(leased, error, leaseStartedAt);
    const [failed] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
    if (!marked) return { kind: "lease_lost", operation: failed ?? leased };
    return {
      kind: "failed",
      operation: failed ?? leased,
      error,
    };
  }

  let restoreOperation;
  try {
    restoreOperation = await getProvisioningProvider().restoreSnapshot({
      tenantId: leased.tenantId,
      targetEnvironmentId: leased.environmentId,
      backupReference: snapshot.backupReference,
      idempotencyKey: leased.idempotencyKey,
    });
  } catch (error) {
    if (isRetryableProvisioningProviderError(error)) {
      return { kind: "busy", operation: leased };
    }
    const message = error instanceof Error ? error.message : "Restore provider operation failed";
    const marked = await markRestoreFailure(leased, message, leaseStartedAt);
    const [failed] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
    if (!marked) return { kind: "lease_lost", operation: failed ?? leased };
    return {
      kind: "failed",
      operation: failed ?? leased,
      error: message,
    };
  }
  try {
    const [running] = await db.update(provisioningOperationsTable).set({
      status: "running",
      providerOperationId: restoreOperation.providerOperationId,
    }).where(and(
      eq(provisioningOperationsTable.id, operationId),
      eq(provisioningOperationsTable.status, "requested"),
      eq(provisioningOperationsTable.startedAt, leaseStartedAt),
    )).returning();
    if (!running) {
      const [operation] = await db.select().from(provisioningOperationsTable)
        .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
      if (!operation) throw new Error("Restore operation not found after provider start");
      return { kind: "lease_lost", operation };
    }
    return { kind: "started", operation: running };
  } catch {
    // The provider already accepted the idempotent request. Keep the requested
    // claim and lease so a stale-lease replay can recover the same operation.
    const [operation] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
    return { kind: "busy", operation: operation ?? leased };
  }
}

/** Reconcile a bounded batch so a process restart does not depend on polling. */
export async function reconcileProvisioningRecoverySweep(): Promise<void> {
  const recoverableTypes = inArray(
    provisioningOperationsTable.operationType,
    ["snapshot_prepare", "restore", "refresh", "rollback"],
  );
  const activeOperations = and(
    recoverableTypes,
    inArray(provisioningOperationsTable.status, ["requested", "running"]),
  );
  const terminalOperations = and(
    recoverableTypes,
    inArray(provisioningOperationsTable.status, ["succeeded", "failed"]),
  );
  const batchLimit = Math.max(1, Math.floor(RECOVERY_SWEEP_LIMIT / 2));
  let active = await db.select().from(provisioningOperationsTable).where(and(
    activeOperations,
    gt(provisioningOperationsTable.id, recoverySweepCursor),
  )).orderBy(asc(provisioningOperationsTable.id)).limit(batchLimit);
  if (!active.length && recoverySweepCursor !== 0) {
    recoverySweepCursor = 0;
    active = await db.select().from(provisioningOperationsTable).where(activeOperations)
      .orderBy(asc(provisioningOperationsTable.id)).limit(batchLimit);
  }
  if (active.length) recoverySweepCursor = active[active.length - 1].id;

  let terminal = await db.select().from(provisioningOperationsTable).where(and(
    terminalOperations,
    gt(provisioningOperationsTable.id, terminalRecoverySweepCursor),
  )).orderBy(asc(provisioningOperationsTable.id)).limit(batchLimit);
  if (!terminal.length && terminalRecoverySweepCursor !== 0) {
    terminalRecoverySweepCursor = 0;
    terminal = await db.select().from(provisioningOperationsTable).where(terminalOperations)
      .orderBy(asc(provisioningOperationsTable.id)).limit(batchLimit);
  }
  if (terminal.length) terminalRecoverySweepCursor = terminal[terminal.length - 1].id;
  const operations = [...active, ...terminal];

  for (const operation of operations) {
    try {
      if (operation.operationType === SNAPSHOT_PREPARATION_OPERATION_TYPE) {
        const preparation = await reconcileSnapshotPreparationOperation(operation.id);
        if (preparation.status === "failed") {
          await markSnapshotPreparationFailure(
            preparation.operation,
            preparation.operation.error ?? "Snapshot preparation failed",
          );
        }
        if (preparation.status === "succeeded") {
          const details = preparation.operation.details ?? {};
          const refreshId = typeof details.refreshId === "number" ? details.refreshId : undefined;
          const snapshotId = typeof details.snapshotId === "number" ? details.snapshotId : undefined;
          const sourceEnvironmentId = typeof details.sourceEnvironmentId === "number"
            ? details.sourceEnvironmentId
            : undefined;
          const sanitizationPolicy = typeof details.sanitizationPolicy === "string"
            ? details.sanitizationPolicy
            : undefined;
          const [refresh] = refreshId
            ? await db.select().from(environmentRefreshesTable)
              .where(eq(environmentRefreshesTable.id, refreshId)).limit(1)
            : [];
          const [snapshot] = snapshotId
            ? await db.select().from(environmentSnapshotsTable)
              .where(eq(environmentSnapshotsTable.id, snapshotId)).limit(1)
            : [];
          if (refresh && snapshot && sourceEnvironmentId !== undefined && sanitizationPolicy) {
            await resumeRefreshOperation({
              refresh,
              snapshot,
              sourceEnvironmentId,
              sanitizationPolicy,
              requestedByUserId: preparation.operation.requestedByUserId ?? undefined,
            });
          }
        }
        continue;
      }
      if (operation.status === "succeeded" || operation.status === "failed") {
        await repairTerminalRestoreOperation(operation);
        continue;
      }
      let current = operation;
      if (current.status === "requested") {
        const started = await startRestoreOperation(current.id);
        if (started.kind === "busy" || started.kind === "lease_lost") continue;
        current = started.operation;
        if (started.kind === "failed") continue;
      }
      if (current.status === "running") await reconcileRestoreOperation(current.id);
    } catch {
      // Provider and database error details remain in the operation audit row;
      // do not put potentially sensitive provider messages in process logs.
      logger.warn({ operationId: operation.id, operationType: operation.operationType }, "Recovery sweep item failed");
    }
  }
}

router.get("/platform/environments/:environmentId/provisioning-operations", async (req: TenantRequest, res) => {
  const id = parseId(req.params.environmentId);
  if (!id) { res.status(400).json({ error: "Invalid environment" }); return; }
  const target = await environment(id);
  if (!target) { res.status(404).json({ error: "Environment not found" }); return; }
  const operations = await db.select().from(provisioningOperationsTable)
    .where(and(
      eq(provisioningOperationsTable.tenantId, target.tenantId),
      eq(provisioningOperationsTable.environmentId, id),
      inArray(provisioningOperationsTable.operationType, ["restore", "refresh", "rollback"]),
    ))
    .orderBy(desc(provisioningOperationsTable.createdAt), desc(provisioningOperationsTable.id))
    .limit(RECOVERY_OPERATION_HISTORY_LIMIT);
  res.json(operations);
});

router.get("/platform/provisioning-operations/:operationId", async (req: TenantRequest, res) => {
  const operationId = parseId(req.params.operationId);
  if (!operationId) { res.status(400).json({ error: "Invalid provisioning operation" }); return; }
  const [operation] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, operationId)).limit(1);
  if (!operation) { res.status(404).json({ error: "Provisioning operation not found" }); return; }
  if (!["restore", "refresh", "rollback"].includes(operation.operationType)) {
    res.status(400).json({ error: "Operation is not a recovery operation" });
    return;
  }
  const result = await reconcileRestoreOperation(operation.id);
  const [updated] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, operation.id)).limit(1);
  res.status(result.status === "failed" ? 502 : result.status === "pending" ? 202 : 200)
    .json(updated ?? operation);
});

router.get("/platform/environments/:environmentId/resources", async (req: TenantRequest, res) => {
  const id = parseId(req.params.environmentId);
  if (!id) { res.status(400).json({ error: "Invalid environment" }); return; }
  const target = await environment(id);
  if (!target) { res.status(404).json({ error: "Environment not found" }); return; }
  const resources = await db.select().from(environmentResourcesTable)
    .where(eq(environmentResourcesTable.environmentId, id));
  res.json({
    environment: target,
    executionContextReady: isIsolatedEnvironmentReady(resources),
    resources,
  });
});

router.get("/platform/environments/:environmentId/provisioning-events", async (req: TenantRequest, res) => {
  const id = parseId(req.params.environmentId);
  if (!id) { res.status(400).json({ error: "Invalid environment" }); return; }
  const target = await environment(id);
  if (!target) { res.status(404).json({ error: "Environment not found" }); return; }
  res.json(await db.select().from(provisioningEventsTable)
    .where(eq(provisioningEventsTable.environmentId, id))
    .orderBy(desc(provisioningEventsTable.occurredAt)));
});

router.post("/platform/environments/:environmentId/provision", async (req: TenantRequest, res) => {
  const id = parseId(req.params.environmentId);
  const parsed = ProvisionEnvironmentBody.safeParse(req.body);
  if (!id || !parsed.success) { res.status(400).json({ error: "Invalid provisioning request", details: parsed.success ? undefined : parsed.error.issues }); return; }
  const target = await environment(id);
  if (!target) { res.status(404).json({ error: "Environment not found" }); return; }
  const provider = getProvisioningProvider();
  const failures: string[] = [];
  let runningDuplicate = false;
  let succeededReplay = false;
  for (const resourceType of ISOLATED_RESOURCE_TYPES) {
    const operationKey = `${parsed.data.idempotencyKey}:${resourceType}`;
    const claim = await db.transaction(async (tx) => {
      let [resource] = await tx.select().from(environmentResourcesTable).where(and(
        eq(environmentResourcesTable.environmentId, id),
        eq(environmentResourcesTable.resourceType, resourceType),
      )).for("update").limit(1);
      if (!resource) {
        await tx.insert(environmentResourcesTable).values({
          tenantId: target.tenantId,
          environmentId: id,
          resourceType,
          providerKey: parsed.data.providerKey ?? provider.key,
          status: "requested",
        }).onConflictDoNothing({
          target: [environmentResourcesTable.environmentId, environmentResourcesTable.resourceType],
        });
        [resource] = await tx.select().from(environmentResourcesTable).where(and(
          eq(environmentResourcesTable.environmentId, id),
          eq(environmentResourcesTable.resourceType, resourceType),
        )).for("update").limit(1);
      }
      if (!resource) return { kind: "failed" as const, error: "Resource row could not be claimed" };
      const [previous] = await tx.select().from(provisioningOperationsTable).where(and(
        eq(provisioningOperationsTable.environmentId, id),
        eq(provisioningOperationsTable.operationType, "provision"),
        eq(provisioningOperationsTable.idempotencyKey, operationKey),
      )).for("update").limit(1);
      if (previous) return { kind: "existing" as const, resource, operation: previous };
      const [active] = await tx.select().from(provisioningOperationsTable).where(and(
        eq(provisioningOperationsTable.resourceId, resource.id),
        inArray(provisioningOperationsTable.status, ["running", "requested"]),
      )).for("update").limit(1);
      if (active) return { kind: "existing" as const, resource, operation: active };
      if (resource.status === "ready") {
        // A new environment-level retry may legitimately reuse resources that
        // succeeded during an earlier partial attempt. The failed resources
        // below still receive a new provider operation; ready resources need
        // no destructive provider call.
        return { kind: "ready" as const, resource };
      }
      try {
        assertResourceTransition(resource.status as Parameters<typeof assertResourceTransition>[0], "provisioning");
      } catch (error) {
        return { kind: "failed" as const, resource, error: error instanceof Error ? error.message : "Invalid resource state" };
      }
      const [operation] = await tx.insert(provisioningOperationsTable).values({
        tenantId: target.tenantId,
        environmentId: id,
        resourceId: resource.id,
        operationType: "provision",
        idempotencyKey: operationKey,
        status: "running",
        requestedByUserId: req.localUserId,
        startedAt: new Date(),
      }).returning();
      await tx.update(environmentResourcesTable).set({ status: "provisioning", lastError: null, updatedAt: new Date() })
        .where(eq(environmentResourcesTable.id, resource.id));
      return { kind: "claimed" as const, resource, operation };
    });
    if (claim.kind === "existing") {
      if (claim.operation.status === "running" || claim.operation.status === "requested") runningDuplicate = true;
      if (claim.operation.status === "succeeded") succeededReplay = true;
      if (claim.operation.status === "failed") failures.push(`${resourceType}: ${claim.operation.error ?? "provider operation failed"}`);
      continue;
    }
    if (claim.kind === "failed") {
      failures.push(`${resourceType}: ${claim.error}`);
      continue;
    }
    if (claim.kind === "ready") {
      succeededReplay = true;
      continue;
    }
    const { resource, operation } = claim;
    try {
      const provisioned = await provider.provisionResource({
        tenantId: target.tenantId,
        environmentId: id,
        resourceType,
        idempotencyKey: operationKey,
      });
      if (resourceType === "runtime") {
        if (!provisioned.endpoint) throw new Error("Provisioning provider did not return a runtime endpoint");
        const runtimeEndpoint = new URL(provisioned.endpoint);
        if (!["http:", "https:"].includes(runtimeEndpoint.protocol) || runtimeEndpoint.username || runtimeEndpoint.password) {
          throw new Error("Provisioning provider returned an unsafe runtime endpoint");
        }
      }
      if ((resourceType === "runtime" || resourceType === "secrets") && !provisioned.secretReference) {
        throw new Error("Provisioning provider did not return an opaque runtime secret reference");
      }
      await db.transaction(async (tx) => {
        const [lockedOperation] = await tx.select().from(provisioningOperationsTable)
          .where(eq(provisioningOperationsTable.id, operation.id)).for("update").limit(1);
        if (lockedOperation?.status !== "running") return;
        await tx.update(environmentResourcesTable).set({
          status: "ready",
          externalId: provisioned.externalId,
          endpoint: provisioned.endpoint,
          secretReference: provisioned.secretReference ?? null,
          metadata: redactProviderMetadata(provisioned.metadata),
          lastError: null,
          provisionedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(eq(environmentResourcesTable.id, resource.id), eq(environmentResourcesTable.status, "provisioning")));
        await tx.update(provisioningOperationsTable).set({
          status: "succeeded",
          providerOperationId: provisioned.providerOperationId,
          completedAt: new Date(),
        }).where(and(eq(provisioningOperationsTable.id, operation.id), eq(provisioningOperationsTable.status, "running")));
      });
      await writeEvent(req.localUserId!, target.tenantId, id, "provisioned", {
        resourceType, externalId: provisioned.externalId,
      }, resource.id, operation.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider operation failed";
      await db.transaction(async (tx) => {
        const [lockedOperation] = await tx.select().from(provisioningOperationsTable)
          .where(eq(provisioningOperationsTable.id, operation.id)).for("update").limit(1);
        if (lockedOperation?.status !== "running") return;
        await tx.update(environmentResourcesTable).set({ status: "failed", lastError: message, updatedAt: new Date() })
          .where(and(eq(environmentResourcesTable.id, resource.id), eq(environmentResourcesTable.status, "provisioning")));
        await tx.update(provisioningOperationsTable).set({ status: "failed", error: message, completedAt: new Date() })
          .where(and(eq(provisioningOperationsTable.id, operation.id), eq(provisioningOperationsTable.status, "running")));
      });
      failures.push(`${resourceType}: ${message}`);
      await writeEvent(req.localUserId!, target.tenantId, id, "provision_failed", { resourceType, error: message }, resource.id, operation.id);
    }
  }
  const derived = await refreshEnvironmentStatus(id);
  const current = await db.select().from(environmentResourcesTable).where(eq(environmentResourcesTable.environmentId, id));
  if (runningDuplicate && !failures.length) {
    res.status(202).json({ status: "provisioning", resources: current });
    return;
  }
  if (failures.length || derived.provisioningStatus !== "ready") {
    res.status(503).json({ error: "Environment provisioning failed explicitly", failures, resources: current });
    return;
  }
  res.status(succeededReplay ? 200 : 201).json({ executionContextReady: isIsolatedEnvironmentReady(current), resources: current });
});

router.post("/platform/environments/:environmentId/verify", async (req: TenantRequest, res) => {
  const id = parseId(req.params.environmentId);
  const parsed = VerifyEnvironmentBody.safeParse(req.body);
  if (!id || !parsed.success) { res.status(400).json({ error: "Invalid verification request" }); return; }
  const target = await environment(id);
  if (!target) { res.status(404).json({ error: "Environment not found" }); return; }
  const resources = await db.select().from(environmentResourcesTable).where(eq(environmentResourcesTable.environmentId, id));
  const provider = getProvisioningProvider();
  const providerChecks: Record<string, unknown> = {};
  let providerHealthy = true;
  for (const resource of resources) {
    if (resource.status !== "ready" || !resource.externalId) {
      providerHealthy = false;
      providerChecks[resource.resourceType] = { healthy: false, error: "Resource is not ready or has no provider identity" };
      continue;
    }
    try {
      providerChecks[resource.resourceType] = parseProviderVerificationResult(await provider.verifyResource({
        tenantId: target.tenantId,
        environmentId: id,
        resourceType: resource.resourceType as Parameters<typeof provider.verifyResource>[0]["resourceType"],
        externalId: resource.externalId,
        idempotencyKey: `${parsed.data.idempotencyKey}:${resource.resourceType}`,
      }));
    } catch (error) {
      providerHealthy = false;
      const message = error instanceof Error ? error.message : "Provider verification failed";
      providerChecks[resource.resourceType] = { healthy: false, error: message };
      await db.update(environmentResourcesTable).set({ status: "degraded", lastError: message, updatedAt: new Date() })
        .where(eq(environmentResourcesTable.id, resource.id));
    }
  }
  const checks = {
    resourceTypes: resources.map((resource) => ({ resourceType: resource.resourceType, status: resource.status })),
    provider: providerChecks,
    isolated: providerHealthy && isIsolatedEnvironmentReady(resources) && isRuntimeSigningBoundaryReady(resources),
  };
  const [health] = await db.insert(environmentHealthChecksTable).values({
    tenantId: target.tenantId,
    environmentId: id,
    status: checks.isolated ? "healthy" : "unhealthy",
    checks,
    checkedByUserId: req.localUserId,
  }).returning();
  await refreshEnvironmentStatus(id);
  await writeEvent(req.localUserId!, target.tenantId, id, "environment_verified", checks);
  res.status(checks.isolated ? 200 : 503).json(health);
});

router.post("/platform/environments/:environmentId/enforce-isolation", async (req: TenantRequest, res) => {
  const id = parseId(req.params.environmentId);
  if (!id) { res.status(400).json({ error: "Invalid environment" }); return; }
  const target = await environment(id);
  if (!target) { res.status(404).json({ error: "Environment not found" }); return; }
  const resources = await db.select().from(environmentResourcesTable)
    .where(eq(environmentResourcesTable.environmentId, id));
  const [health] = await db.select({ status: environmentHealthChecksTable.status, checkedAt: environmentHealthChecksTable.checkedAt })
    .from(environmentHealthChecksTable)
    .where(eq(environmentHealthChecksTable.environmentId, id))
    .orderBy(desc(environmentHealthChecksTable.checkedAt)).limit(1);
  if (!isIsolatedEnvironmentReady(resources) || !isRuntimeSigningBoundaryReady(resources) || !isRecentHealthyCheck(health)) {
    res.status(409).json({ error: "Isolation enforcement requires ready resources and a recent successful health check" });
    return;
  }
  const [updated] = await db.update(environmentsTable).set({
    isolationEnforced: true,
    provisioningStatus: "ready",
    updatedAt: new Date(),
  }).where(eq(environmentsTable.id, id)).returning();
  await writeEvent(req.localUserId!, target.tenantId, id, "isolation_enforced", { healthCheckId: health ? true : false });
  res.json(updated);
});

router.get("/platform/environments/:environmentId/snapshots", async (req: TenantRequest, res) => {
  const id = parseId(req.params.environmentId);
  if (!id) { res.status(400).json({ error: "Invalid environment" }); return; }
  const target = await environment(id);
  if (!target) { res.status(404).json({ error: "Environment not found" }); return; }
  res.json(await db.select().from(environmentSnapshotsTable)
    .where(eq(environmentSnapshotsTable.environmentId, id))
    .orderBy(desc(environmentSnapshotsTable.createdAt)));
});

router.post("/platform/environments/:environmentId/snapshots", async (req: TenantRequest, res) => {
  const id = parseId(req.params.environmentId);
  const parsed = VerifyEnvironmentSnapshotBody.safeParse(req.body);
  if (!id || !parsed.success) { res.status(400).json({ error: "Invalid backup request" }); return; }
  const target = await environment(id);
  if (!target) { res.status(404).json({ error: "Environment not found" }); return; }
  const [existingSnapshot] = await db.select().from(environmentSnapshotsTable).where(and(
    eq(environmentSnapshotsTable.environmentId, target.id),
    eq(environmentSnapshotsTable.idempotencyKey, parsed.data.idempotencyKey),
  )).limit(1);
  if (existingSnapshot) {
    res.status(200).json(existingSnapshot);
    return;
  }
  const [snapshot] = await db.insert(environmentSnapshotsTable).values({
    tenantId: target.tenantId,
    environmentId: target.id,
    idempotencyKey: parsed.data.idempotencyKey,
    kind: "backup",
    status: "running",
    sanitized: "not_applicable",
    createdByUserId: req.localUserId,
  }).returning();
  try {
    const result = await getProvisioningProvider().createSnapshot({
      tenantId: target.tenantId,
      sourceEnvironmentId: target.id,
      targetEnvironmentId: target.id,
      sanitized: false,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    const verificationDetails = parseProviderVerificationResult(await getProvisioningProvider().verifySnapshot({
      tenantId: target.tenantId,
      environmentId: target.id,
      backupReference: result.backupReference,
      checksum: result.checksum,
      idempotencyKey: `${parsed.data.idempotencyKey}:verify`,
    }));
    const [verified] = await db.update(environmentSnapshotsTable).set({
      status: "verified",
      backupReference: result.backupReference,
      checksum: result.checksum,
      verificationDetails,
      verifiedAt: new Date(),
    }).where(eq(environmentSnapshotsTable.id, snapshot.id)).returning();
    await writeEvent(req.localUserId!, target.tenantId, target.id, "backup_verified", { snapshotId: snapshot.id });
    res.status(201).json(verified);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backup provider operation failed";
    const [failed] = await db.update(environmentSnapshotsTable).set({
      status: "failed", verificationDetails: { error: message },
    }).where(eq(environmentSnapshotsTable.id, snapshot.id)).returning();
    await writeEvent(req.localUserId!, target.tenantId, target.id, "backup_failed", { snapshotId: snapshot.id, error: message });
    res.status(503).json({ error: "Environment backup failed explicitly", snapshot: failed, details: message });
  }
});

router.post("/platform/environments/:environmentId/refresh", async (req: TenantRequest, res) => {
  const targetId = parseId(req.params.environmentId);
  const parsed = RefreshDtdEnvironmentBody.safeParse(req.body);
  if (!targetId || !parsed.success) { res.status(400).json({ error: "Invalid refresh request", details: parsed.success ? undefined : parsed.error.issues }); return; }
  const [source, target] = await Promise.all([environment(parsed.data.sourceEnvironmentId), environment(targetId)]);
  if (!source || !target) { res.status(404).json({ error: "Source or target environment not found" }); return; }
  try {
    assertProductionToDtdRefresh(source, target, parsed.data.sanitizationPolicy);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Invalid refresh" });
    return;
  }
  const [existingRefresh] = await db.select().from(environmentRefreshesTable).where(and(
    eq(environmentRefreshesTable.targetEnvironmentId, target.id),
    eq(environmentRefreshesTable.idempotencyKey, parsed.data.idempotencyKey),
  )).limit(1);
  if (existingRefresh) {
    if (existingRefresh.sourceEnvironmentId !== source.id ||
      existingRefresh.sanitizationPolicy !== parsed.data.sanitizationPolicy) {
      res.status(409).json({ error: "Idempotency key is already associated with a different refresh source or sanitization policy" });
      return;
    }
    if (!existingRefresh.snapshotId) {
      res.status(409).json({ error: "Existing refresh has no associated snapshot" });
      return;
    }
    const [existingSnapshot] = await db.select().from(environmentSnapshotsTable)
      .where(eq(environmentSnapshotsTable.id, existingRefresh.snapshotId)).limit(1);
    if (!existingSnapshot) {
      res.status(409).json({ error: "Existing refresh snapshot could not be found" });
      return;
    }
    const resumed = await resumeRefreshOperation({
      refresh: existingRefresh,
      snapshot: existingSnapshot,
      sourceEnvironmentId: source.id,
      sanitizationPolicy: parsed.data.sanitizationPolicy,
      requestedByUserId: req.localUserId,
    });
    const status = resumed.status === "conflict" ? 409 : resumed.status === "failed" ? 502 : resumed.status === "succeeded" ? 200 : 202;
    res.status(status).json({
      refresh: resumed.refresh,
      snapshot: resumed.snapshot,
      refreshId: resumed.refresh.id,
      snapshotId: resumed.snapshot.id,
      operationId: resumed.operation?.id,
      ...("error" in resumed ? { error: resumed.error } : {}),
    });
    return;
  }
  // Claim both durable rows in one transaction. A concurrent request waits
  // for this transaction and then resumes the same refresh instead of
  // observing a snapshot with no refresh row (or surfacing a unique-index
  // exception as an opaque 500).
  const creation = await db.transaction(async (tx) => {
    const [insertedSnapshot] = await tx.insert(environmentSnapshotsTable).values({
      tenantId: target.tenantId,
      environmentId: target.id,
      sourceEnvironmentId: source.id,
      idempotencyKey: parsed.data.idempotencyKey,
      kind: "refresh",
      status: "running",
      sanitized: "pending",
      sanitizationPolicy: parsed.data.sanitizationPolicy,
      createdByUserId: req.localUserId,
    }).onConflictDoNothing({
      target: [environmentSnapshotsTable.environmentId, environmentSnapshotsTable.idempotencyKey],
    }).returning();
    const [durableSnapshot] = insertedSnapshot
      ? [insertedSnapshot]
      : await tx.select().from(environmentSnapshotsTable).where(and(
        eq(environmentSnapshotsTable.environmentId, target.id),
        eq(environmentSnapshotsTable.idempotencyKey, parsed.data.idempotencyKey),
      )).limit(1);
    if (!durableSnapshot) throw new Error("Refresh snapshot could not be claimed");

    const [insertedRefresh] = await tx.insert(environmentRefreshesTable).values({
      tenantId: target.tenantId,
      sourceEnvironmentId: source.id,
      targetEnvironmentId: target.id,
      snapshotId: durableSnapshot.id,
      idempotencyKey: parsed.data.idempotencyKey,
      status: "running",
      sanitizationPolicy: parsed.data.sanitizationPolicy,
      requestedByUserId: req.localUserId,
      startedAt: new Date(),
    }).onConflictDoNothing({
      target: [environmentRefreshesTable.targetEnvironmentId, environmentRefreshesTable.idempotencyKey],
    }).returning();
    const [durableRefresh] = insertedRefresh
      ? [insertedRefresh]
      : await tx.select().from(environmentRefreshesTable).where(and(
        eq(environmentRefreshesTable.targetEnvironmentId, target.id),
        eq(environmentRefreshesTable.idempotencyKey, parsed.data.idempotencyKey),
      )).limit(1);
    if (!durableRefresh) throw new Error("Refresh operation could not be claimed");
    return {
      snapshot: durableSnapshot,
      refresh: durableRefresh,
      created: Boolean(insertedSnapshot && insertedRefresh),
    };
  });
  if (!creation.created) {
    if (creation.refresh.sourceEnvironmentId !== source.id ||
      creation.refresh.sanitizationPolicy !== parsed.data.sanitizationPolicy) {
      res.status(409).json({ error: "Idempotency key is already associated with a different refresh source or sanitization policy" });
      return;
    }
    const resumed = await resumeRefreshOperation({
      refresh: creation.refresh,
      snapshot: creation.snapshot,
      sourceEnvironmentId: source.id,
      sanitizationPolicy: parsed.data.sanitizationPolicy,
      requestedByUserId: req.localUserId,
    });
    const status = resumed.status === "conflict" ? 409 : resumed.status === "failed" ? 502 : resumed.status === "succeeded" ? 200 : 202;
    res.status(status).json({
      refresh: resumed.refresh,
      snapshot: resumed.snapshot,
      refreshId: resumed.refresh.id,
      snapshotId: resumed.snapshot.id,
      operationId: resumed.operation?.id,
      ...("error" in resumed ? { error: resumed.error } : {}),
    });
    return;
  }
  const { snapshot, refresh } = creation;
  try {
    const resumed = await resumeRefreshOperation({
      refresh,
      snapshot,
      sourceEnvironmentId: source.id,
      sanitizationPolicy: parsed.data.sanitizationPolicy,
      requestedByUserId: req.localUserId,
    });
    if (resumed.status === "conflict") {
      res.status(409).json({ error: resumed.error, refreshId: refresh.id, snapshotId: snapshot.id });
      return;
    }
    if (resumed.status === "pending") {
      await writeEvent(req.localUserId!, target.tenantId, target.id, "refresh_started", {
        refreshId: refresh.id, snapshotId: snapshot.id, sourceEnvironmentId: source.id,
        sanitizationPolicy: parsed.data.sanitizationPolicy,
        operationId: resumed.operation?.id,
      }, undefined, resumed.operation?.id);
    }
    res.status(resumed.status === "failed" ? 502 : resumed.status === "succeeded" ? 201 : 202)
      .json({
        refresh: resumed.refresh,
        snapshot: resumed.snapshot,
        operationId: resumed.operation?.id,
        ...("error" in resumed ? { details: resumed.error } : {}),
      });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Snapshot provider operation failed";
    const [[currentRefresh], [currentSnapshot], [restoreOperation]] = await Promise.all([
      db.select().from(environmentRefreshesTable).where(eq(environmentRefreshesTable.id, refresh.id)).limit(1),
      db.select().from(environmentSnapshotsTable).where(eq(environmentSnapshotsTable.id, snapshot.id)).limit(1),
      db.select().from(provisioningOperationsTable).where(and(
        eq(provisioningOperationsTable.environmentId, target.id),
        eq(provisioningOperationsTable.operationType, "refresh"),
        eq(provisioningOperationsTable.idempotencyKey, `${parsed.data.idempotencyKey}:restore`),
      )).limit(1),
    ]);
    const completed = currentRefresh?.status === "completed" && restoreOperation?.status === "succeeded";
    const failed = currentRefresh?.status === "failed" || restoreOperation?.status === "failed";
    res.status(completed ? 200 : failed ? 502 : 503).json({
      error: completed ? undefined : failed
        ? "Production-to-DTD refresh failed explicitly"
        : "Production-to-DTD refresh remains recoverable after an internal persistence error",
      refresh: currentRefresh ?? refresh,
      snapshot: currentSnapshot ?? snapshot,
      operationId: restoreOperation?.id,
      details: message,
    });
    return;
  }
});

router.post("/platform/snapshots/:snapshotId/verify", async (req: TenantRequest, res) => {
  const snapshotId = parseId(req.params.snapshotId);
  const parsed = VerifyEnvironmentSnapshotBody.safeParse(req.body);
  if (!snapshotId || !parsed.success) { res.status(400).json({ error: "Invalid snapshot verification request" }); return; }
  const [snapshot] = await db.select().from(environmentSnapshotsTable).where(eq(environmentSnapshotsTable.id, snapshotId)).limit(1);
  if (!snapshot) { res.status(404).json({ error: "Snapshot not found" }); return; }
  try {
    if (!snapshot.backupReference || !snapshot.checksum) {
      throw new Error("Snapshot has no provider backup reference or checksum");
    }
    const verificationDetails = parseProviderVerificationResult(await getProvisioningProvider().verifySnapshot({
      tenantId: snapshot.tenantId,
      environmentId: snapshot.environmentId,
      backupReference: snapshot.backupReference,
      checksum: snapshot.checksum,
      idempotencyKey: parsed.data.idempotencyKey,
    }));
    const [updated] = await db.update(environmentSnapshotsTable).set({
      status: "verified", verificationDetails, verifiedAt: new Date(),
    }).where(eq(environmentSnapshotsTable.id, snapshotId)).returning();
    await writeEvent(req.localUserId!, snapshot.tenantId, snapshot.environmentId, "snapshot_verified", { snapshotId });
    res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Snapshot verification failed";
    const [updated] = await db.update(environmentSnapshotsTable).set({
      status: "failed",
      verificationDetails: { verified: false, error: message },
    }).where(eq(environmentSnapshotsTable.id, snapshotId)).returning();
    await writeEvent(req.localUserId!, snapshot.tenantId, snapshot.environmentId, "snapshot_verification_failed", { snapshotId, error: message });
    res.status(503).json({ error: message, snapshot: updated });
  }
});

router.post("/platform/snapshots/:snapshotId/restore", async (req: TenantRequest, res) => {
  const snapshotId = parseId(req.params.snapshotId);
  const parsed = RestoreEnvironmentSnapshotBody.safeParse(req.body);
  if (!snapshotId || !parsed.success) { res.status(400).json({ error: "Invalid snapshot restore request" }); return; }
  const [snapshot] = await db.select().from(environmentSnapshotsTable).where(eq(environmentSnapshotsTable.id, snapshotId)).limit(1);
  if (!snapshot) { res.status(404).json({ error: "Snapshot not found" }); return; }
  if (snapshot.status !== "verified" || !snapshot.backupReference) {
    res.status(409).json({ error: "Only a verified snapshot with a backup reference can be restored" });
    return;
  }
  const operationType = parsed.data.rollback ? "rollback" : "restore";
  const claim = await claimRestoreOperation({
    tenantId: snapshot.tenantId,
    environmentId: snapshot.environmentId,
    requestedByUserId: req.localUserId,
    operationType,
    idempotencyKey: parsed.data.idempotencyKey,
    details: { snapshotId, rollback: parsed.data.rollback === true },
  });
  if (claim.kind === "conflict") {
    res.status(409).json({ error: claim.error });
    return;
  }
  let operation = claim.operation;
  try {
    if (operation.status === "requested") {
      const started = await startRestoreOperation(operation.id);
      if (started.kind === "busy" || started.kind === "lease_lost") {
        res.status(202).json({ operation: started.operation, snapshotId });
        return;
      }
      if (started.kind === "failed") {
        res.status(503).json({
          error: "Snapshot restore failed explicitly",
          details: started.error,
          operationId: started.operation.id,
        });
        return;
      }
      operation = started.operation;
    }
    const reconciled = await reconcileRestoreOperation(operation.id);
    const [updatedOperation] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operation.id)).limit(1);
    res.status(reconciled.status === "failed" ? 502 : reconciled.status === "succeeded" ? 200 : 202)
      .json({ operation: updatedOperation ?? operation, snapshotId });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restore provider operation failed";
    const [currentOperation] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operation.id)).limit(1);
    res.status(currentOperation?.status === "succeeded" ? 200 : currentOperation?.status === "failed" ? 502 : 503).json({
      error: currentOperation?.status === "failed"
        ? "Snapshot restore failed explicitly"
        : currentOperation?.status === "succeeded"
          ? undefined
          : "Snapshot restore remains recoverable after an internal persistence error",
      details: message,
      operation: currentOperation ?? operation,
      operationId: operation.id,
      snapshotId,
    });
    return;
  }
});

router.post("/platform/release-assignments/:assignmentId/rollback", async (req: TenantRequest, res) => {
  const assignmentId = parseId(req.params.assignmentId);
  const parsed = RestoreEnvironmentSnapshotBody.safeParse(req.body);
  if (!assignmentId || !parsed.success) { res.status(400).json({ error: "Invalid release rollback request" }); return; }
  const [assignment] = await db.select().from(environmentReleaseAssignmentsTable)
    .where(eq(environmentReleaseAssignmentsTable.id, assignmentId)).limit(1);
  if (!assignment) {
    res.status(404).json({ error: "Release assignment not found" });
    return;
  }
  const assignmentEnvironment = await environment(assignment.environmentId);
  const [control] = await db.select().from(environmentReleaseControlsTable)
    .where(eq(environmentReleaseControlsTable.assignmentId, assignmentId)).limit(1);
  if (!control?.rollbackSnapshotId) {
    res.status(409).json({ error: "Release has no rollback snapshot control record" });
    return;
  }
  const [snapshot] = await db.select().from(environmentSnapshotsTable)
    .where(eq(environmentSnapshotsTable.id, control.rollbackSnapshotId)).limit(1);
  if (!snapshot || snapshot.status !== "verified" || !snapshot.backupReference) {
    res.status(409).json({ error: "Release rollback requires a verified rollback snapshot" });
    return;
  }
  if (!assignmentEnvironment || assignment.environmentId !== snapshot.environmentId ||
    assignmentEnvironment.tenantId !== snapshot.tenantId) {
    res.status(409).json({ error: "Release rollback snapshot does not belong to the assigned environment" });
    return;
  }
  const claim = await claimRestoreOperation({
    tenantId: snapshot.tenantId,
    environmentId: snapshot.environmentId,
    requestedByUserId: req.localUserId,
    operationType: "rollback",
    idempotencyKey: parsed.data.idempotencyKey,
    details: { assignmentId, snapshotId: snapshot.id, rollback: true, releaseRollback: true },
  });
  if (claim.kind === "conflict") {
    res.status(409).json({ error: claim.error });
    return;
  }
  let operation = claim.operation;
  try {
    if (operation.status === "requested") {
      const started = await startRestoreOperation(operation.id);
      if (started.kind === "busy" || started.kind === "lease_lost") {
        res.status(202).json({ operation: started.operation, controlId: control.id });
        return;
      }
      if (started.kind === "failed") {
        res.status(503).json({
          error: "Release rollback failed explicitly",
          details: started.error,
          operationId: started.operation.id,
        });
        return;
      }
      operation = started.operation;
    }
    const reconciled = await reconcileRestoreOperation(operation.id);
    const [updatedOperation] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operation.id)).limit(1);
    res.status(reconciled.status === "failed" ? 502 : reconciled.status === "succeeded" ? 200 : 202)
      .json({ operation: updatedOperation ?? operation, controlId: control.id });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rollback provider operation failed";
    const [currentOperation] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operation.id)).limit(1);
    res.status(currentOperation?.status === "succeeded" ? 200 : currentOperation?.status === "failed" ? 502 : 503).json({
      error: currentOperation?.status === "failed"
        ? "Release rollback failed explicitly"
        : currentOperation?.status === "succeeded"
          ? undefined
          : "Release rollback remains recoverable after an internal persistence error",
      details: message,
      operation: currentOperation ?? operation,
      operationId: operation.id,
      controlId: control.id,
    });
    return;
  }
});

export default router;