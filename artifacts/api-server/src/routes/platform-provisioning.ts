import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import {
  db,
  environmentHealthChecksTable,
  environmentRefreshesTable,
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
  isRuntimeSigningBoundaryReady,
  redactProviderMetadata,
  parseProviderVerificationResult,
} from "../lib/provisioning";

const router: IRouter = Router();
router.use("/platform", requirePlatformAdmin);

const RESTORE_START_LEASE_MS = 60_000;
const RECOVERY_SWEEP_LIMIT = 100;
let recoverySweepCursor = 0;

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
) {
  const details = operation.details ?? {};
  const [failedOperation] = await db.update(provisioningOperationsTable).set({
    status: "failed",
    error: message,
    completedAt: new Date(),
  }).where(expectedLeaseStartedAt
    ? and(
      eq(provisioningOperationsTable.id, operation.id),
      eq(provisioningOperationsTable.status, "requested"),
      eq(provisioningOperationsTable.startedAt, expectedLeaseStartedAt),
    )
    : and(
      eq(provisioningOperationsTable.id, operation.id),
      inArray(provisioningOperationsTable.status, ["requested", "running"]),
    ),
  ).returning();
  // A stale lease may have been replaced while the provider call was in
  // flight. The replacement owner is responsible for the operation and its
  // audit trail.
  if (!failedOperation) return false;
  await db.update(environmentResourcesTable).set({ status: "degraded", lastError: message, updatedAt: new Date() })
    .where(eq(environmentResourcesTable.environmentId, operation.environmentId));
  const snapshotId = typeof details.snapshotId === "number" ? details.snapshotId : undefined;
  const refreshId = typeof details.refreshId === "number" ? details.refreshId : undefined;
  const assignmentId = typeof details.assignmentId === "number" ? details.assignmentId : undefined;
  if (snapshotId && refreshId) await db.update(environmentSnapshotsTable).set({
    status: "failed",
    verificationDetails: { error: message },
  }).where(eq(environmentSnapshotsTable.id, snapshotId));
  if (refreshId) await db.update(environmentRefreshesTable).set({ status: "failed", error: message, completedAt: new Date() })
    .where(eq(environmentRefreshesTable.id, refreshId));
  if (assignmentId) await db.update(environmentReleaseControlsTable).set({ rollbackStatus: "failed" })
    .where(eq(environmentReleaseControlsTable.assignmentId, assignmentId));
  await writeEvent(operation.requestedByUserId ?? 0, operation.tenantId, operation.environmentId,
    details.releaseRollback ? "release_rollback_failed" : details.rollback ? "rollback_failed" : refreshId ? "refresh_failed" : "restore_failed",
    { operationId: operation.id, snapshotId, refreshId, assignmentId, error: message }, undefined, operation.id);
  return true;
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
    await markRestoreFailure(operation, error instanceof Error ? error.message : "Restored target verification failed");
    return { status: "failed" as const };
  }
  const snapshotId = typeof details.snapshotId === "number" ? details.snapshotId : undefined;
  const refreshId = typeof details.refreshId === "number" ? details.refreshId : undefined;
  const assignmentId = typeof details.assignmentId === "number" ? details.assignmentId : undefined;
  const [succeeded] = await db.update(provisioningOperationsTable).set({
    status: "succeeded", completedAt: new Date(),
    details: { ...details, verification },
  }).where(and(
    eq(provisioningOperationsTable.id, operation.id),
    inArray(provisioningOperationsTable.status, ["requested", "running"]),
  )).returning();
  if (!succeeded) {
    const [current] = await db.select().from(provisioningOperationsTable)
      .where(eq(provisioningOperationsTable.id, operation.id)).limit(1);
    if (current?.status === "succeeded") return { status: "succeeded" as const };
    if (current?.status === "failed") return { status: "failed" as const };
    return { status: "pending" as const, operation: current ?? operation };
  }
  if (refreshId) await db.update(environmentRefreshesTable).set({ status: "completed", completedAt: new Date() })
    .where(eq(environmentRefreshesTable.id, refreshId));
  if (assignmentId) await db.update(environmentReleaseControlsTable).set({ rollbackStatus: "completed", rolledBackAt: new Date() })
    .where(eq(environmentReleaseControlsTable.assignmentId, assignmentId));
  await writeEvent(operation.requestedByUserId ?? 0, operation.tenantId, operation.environmentId,
    details.rollback ? "rollback_completed" : refreshId ? "refresh_completed" : "restore_completed",
    { operationId: operation.id, snapshotId, refreshId, assignmentId }, undefined, operation.id);
  return { status: "succeeded" as const };
}

type RestoreOperationClaim = {
  tenantId: number;
  environmentId: number;
  requestedByUserId?: number;
  operationType: "restore" | "refresh" | "rollback";
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
  const startupError = !snapshot
    ? "Restore operation has no matching snapshot"
    : snapshot.status !== "verified" || !snapshot.backupReference
      ? "Restore operation requires a verified snapshot with a backup reference"
      : undefined;
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

  try {
    const restoreOperation = await getProvisioningProvider().restoreSnapshot({
      tenantId: leased.tenantId,
      targetEnvironmentId: leased.environmentId,
      backupReference: snapshot.backupReference,
      idempotencyKey: leased.idempotencyKey,
    });
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
  } catch (error) {
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
}

/** Reconcile a bounded batch so a process restart does not depend on polling. */
export async function reconcileProvisioningRecoverySweep(): Promise<void> {
  const activeOperations = and(
    inArray(provisioningOperationsTable.operationType, ["restore", "refresh", "rollback"]),
    inArray(provisioningOperationsTable.status, ["requested", "running"]),
  );
  let operations = await db.select().from(provisioningOperationsTable).where(and(
    activeOperations,
    gt(provisioningOperationsTable.id, recoverySweepCursor),
  )).orderBy(asc(provisioningOperationsTable.id)).limit(RECOVERY_SWEEP_LIMIT);
  if (!operations.length && recoverySweepCursor !== 0) {
    recoverySweepCursor = 0;
    operations = await db.select().from(provisioningOperationsTable).where(activeOperations)
      .orderBy(asc(provisioningOperationsTable.id)).limit(RECOVERY_SWEEP_LIMIT);
  }
  if (operations.length) recoverySweepCursor = operations[operations.length - 1].id;

  for (const operation of operations) {
    try {
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
        return { kind: "failed" as const, resource, error: "Resource is already ready; use its existing successful operation" };
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
    const [existingOperation] = await db.select().from(provisioningOperationsTable).where(and(
      eq(provisioningOperationsTable.environmentId, target.id),
      eq(provisioningOperationsTable.operationType, "refresh"),
      eq(provisioningOperationsTable.idempotencyKey, `${parsed.data.idempotencyKey}:restore`),
    )).limit(1);
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
    if (!existingOperation) {
      res.status(409).json({ error: "Existing refresh has no restore operation to reconcile" });
      return;
    }
    res.status(200).json({
      refresh: existingRefresh,
      snapshot: existingSnapshot,
      operationId: existingOperation.id,
    });
    return;
  }
  const [snapshot] = await db.insert(environmentSnapshotsTable).values({
    tenantId: target.tenantId,
    environmentId: target.id,
    sourceEnvironmentId: source.id,
    idempotencyKey: parsed.data.idempotencyKey,
    kind: "refresh",
    status: "running",
    sanitized: "pending",
    sanitizationPolicy: parsed.data.sanitizationPolicy,
    createdByUserId: req.localUserId,
  }).returning();
  const [refresh] = await db.insert(environmentRefreshesTable).values({
    tenantId: target.tenantId,
    sourceEnvironmentId: source.id,
    targetEnvironmentId: target.id,
    snapshotId: snapshot.id,
    idempotencyKey: parsed.data.idempotencyKey,
    status: "running",
    sanitizationPolicy: parsed.data.sanitizationPolicy,
    requestedByUserId: req.localUserId,
    startedAt: new Date(),
  }).returning();
  let claimedOperation: typeof provisioningOperationsTable.$inferSelect | undefined;
  try {
    const result = await getProvisioningProvider().createSnapshot({
      tenantId: target.tenantId,
      sourceEnvironmentId: source.id,
      targetEnvironmentId: target.id,
      sanitized: true,
      sanitizationPolicy: parsed.data.sanitizationPolicy,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    const verificationDetails = parseProviderVerificationResult(await getProvisioningProvider().verifySnapshot({
      tenantId: target.tenantId,
      environmentId: target.id,
      backupReference: result.backupReference,
      checksum: result.checksum,
      idempotencyKey: `${parsed.data.idempotencyKey}:verify`,
    }));
    const [completedSnapshot] = await db.update(environmentSnapshotsTable).set({
      status: "verified", sanitized: "sanitized", backupReference: result.backupReference,
      checksum: result.checksum, verificationDetails, verifiedAt: new Date(),
    }).where(eq(environmentSnapshotsTable.id, snapshot.id)).returning();
    const claim = await claimRestoreOperation({
      tenantId: target.tenantId,
      environmentId: target.id,
      requestedByUserId: req.localUserId,
      operationType: "refresh",
      idempotencyKey: `${parsed.data.idempotencyKey}:restore`,
      details: {
        refreshId: refresh.id,
        snapshotId: snapshot.id,
        sourceEnvironmentId: source.id,
        sanitizationPolicy: parsed.data.sanitizationPolicy,
      },
    });
    if (claim.kind === "conflict") {
      res.status(409).json({ error: claim.error });
      return;
    }
    let operation = claim.operation;
    claimedOperation = operation;
    if (operation.status === "requested") {
      const started = await startRestoreOperation(operation.id);
      if (started.kind === "busy" || started.kind === "lease_lost") {
        const [currentRefresh] = await db.select().from(environmentRefreshesTable)
          .where(eq(environmentRefreshesTable.id, refresh.id)).limit(1);
        res.status(202).json({ refresh: currentRefresh, snapshot: completedSnapshot, operationId: operation.id });
        return;
      }
      if (started.kind === "failed") {
        res.status(503).json({
          error: "Production-to-DTD refresh failed explicitly",
          refreshId: refresh.id,
          snapshotId: snapshot.id,
          operationId: started.operation.id,
          details: started.error,
        });
        return;
      }
      operation = started.operation;
    }
    const reconciled = await reconcileRestoreOperation(operation.id);
    const [currentRefresh] = await db.select().from(environmentRefreshesTable)
      .where(eq(environmentRefreshesTable.id, refresh.id)).limit(1);
    if (reconciled.status === "pending") {
      await writeEvent(req.localUserId!, target.tenantId, target.id, "refresh_started", {
        refreshId: refresh.id, snapshotId: snapshot.id, sourceEnvironmentId: source.id,
        sanitizationPolicy: parsed.data.sanitizationPolicy,
        operationId: operation.id,
      }, undefined, operation.id);
    }
    res.status(reconciled.status === "failed" ? 502 : reconciled.status === "succeeded" ? 201 : 202)
      .json({ refresh: currentRefresh, snapshot: completedSnapshot, operationId: operation.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Snapshot provider operation failed";
    if (claimedOperation) {
      const [currentOperation] = await db.select().from(provisioningOperationsTable)
        .where(eq(provisioningOperationsTable.id, claimedOperation.id)).limit(1);
      if (currentOperation?.status === "running") await markRestoreFailure(currentOperation, message);
    } else {
      await db.update(environmentSnapshotsTable).set({ status: "failed", verificationDetails: { error: message } })
        .where(eq(environmentSnapshotsTable.id, snapshot.id));
      await db.update(environmentRefreshesTable).set({ status: "failed", error: message, completedAt: new Date() })
        .where(eq(environmentRefreshesTable.id, refresh.id));
      await writeEvent(req.localUserId!, target.tenantId, target.id, "refresh_failed", {
        refreshId: refresh.id, snapshotId: snapshot.id, error: message, sanitizationPolicy: parsed.data.sanitizationPolicy,
      });
    }
    res.status(503).json({ error: "Production-to-DTD refresh failed explicitly", refreshId: refresh.id, snapshotId: snapshot.id, details: message });
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
    if (currentOperation?.status === "running") await markRestoreFailure(currentOperation, message);
    res.status(503).json({ error: "Snapshot restore failed explicitly", details: message, operationId: operation.id });
    return;
  }
});

router.post("/platform/release-assignments/:assignmentId/rollback", async (req: TenantRequest, res) => {
  const assignmentId = parseId(req.params.assignmentId);
  const parsed = RestoreEnvironmentSnapshotBody.safeParse(req.body);
  if (!assignmentId || !parsed.success) { res.status(400).json({ error: "Invalid release rollback request" }); return; }
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
    if (currentOperation?.status === "running") await markRestoreFailure(currentOperation, message);
    res.status(503).json({ error: "Release rollback failed explicitly", details: message, operationId: operation.id });
    return;
  }
});

export default router;