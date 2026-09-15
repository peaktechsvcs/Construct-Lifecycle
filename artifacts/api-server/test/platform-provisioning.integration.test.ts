import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import type {
  ProvisionedProviderResource,
  ProvisioningProvider,
  ProviderResourceRequest,
  ProviderVerificationResult,
  RestoreOperation,
} from "../src/lib/provisioning.ts";

process.env.APP_ENV = "test";

const {
  db,
  environmentHealthChecksTable,
  environmentRefreshesTable,
  environmentReleaseAssignmentsTable,
  environmentReleaseControlsTable,
  environmentResourcesTable,
  environmentSnapshotsTable,
  environmentsTable,
  membershipsTable,
  platformReleasesTable,
  pool,
  provisioningEventsTable,
  provisioningOperationsTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const { default: app } = await import("../src/app.ts");
const { configureProvisioningProvider, ProvisioningProviderRequestError } =
  await import("../src/lib/provisioning.ts");
const { reconcileProvisioningRecoverySweep } = await import("../src/routes/platform-provisioning.ts");

type Json = Record<string, unknown> | unknown[];

const runId = `${Date.now()}-${process.pid}`;
const clerkUserId = `platform-provisioning-admin-${runId}`;
const resourceTypes = ["runtime", "database", "storage", "queue", "secrets", "jobs", "logs"] as const;

let server: Server;
let baseUrl = "";
let tenantAId: number;
let tenantBId: number;
let productionAId: number;
let dtdAId: number;
let dtdBId: number;
let failureEnvironmentId: number;
let platformAdminId: number;
let releaseId: number;
let releaseAssignmentId: number;
let releaseRollbackSnapshotId: number;

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-clerk-user-id": clerkUserId,
      ...init.headers,
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Json : undefined,
  };
}

class InMemoryProvisioningProvider implements ProvisioningProvider {
  readonly key = "platform-provisioning-integration";
  readonly provisionCalls: ProviderResourceRequest[] = [];
  readonly snapshotCalls: Array<{ sourceEnvironmentId: number; targetEnvironmentId: number; idempotencyKey: string }> = [];
  readonly restoreCalls: Array<{ targetEnvironmentId: number; idempotencyKey: string }> = [];
  failProvisionFor = new Set<string>();
  failVerification = false;
  snapshotStatusRaceKeys = new Set<string>();
  snapshotError?: Error;
  restoreStartError?: Error;
  restorePollError?: Error;
  restoreVerifyError?: Error;
  refreshVerificationMode: "valid" | "not-sanitized" | "wrong-policy" = "valid";
  restoreMode: "success" | "pending" | "failed" | "throw" = "success";

  async provisionResource(request: ProviderResourceRequest): Promise<ProvisionedProviderResource> {
    this.provisionCalls.push(request);
    if (this.failProvisionFor.has(`${request.environmentId}:${request.resourceType}`)) {
      throw new Error(`provider resource failure for ${request.resourceType}`);
    }
    return {
      externalId: `provider-${request.environmentId}-${request.resourceType}`,
      endpoint: request.resourceType === "runtime"
        ? `https://runtime-${request.environmentId}.provider.test`
        : undefined,
      secretReference: request.resourceType === "runtime" || request.resourceType === "secrets"
        ? `opaque-secret-${request.environmentId}-${request.resourceType}`
        : undefined,
      metadata: {
        region: "integration",
        token: "must-not-be-persisted",
        nested: { signingKey: "must-not-be-persisted", zone: "test" },
      },
      providerOperationId: `provision-operation-${request.environmentId}-${request.resourceType}`,
    };
  }

  async verifyResource(
    request: ProviderResourceRequest & { externalId: string },
  ): Promise<ProviderVerificationResult> {
    if (this.failVerification) throw new Error(`provider health failure for ${request.resourceType}`);
    return { verified: true, healthy: true, externalId: request.externalId };
  }

  async resolveRuntimeSigningKey(): Promise<string> {
    return "integration-signing-key-that-is-long-enough";
  }

  async createSnapshot(request: {
    tenantId: number;
    sourceEnvironmentId: number;
    targetEnvironmentId: number;
    sanitized: boolean;
    sanitizationPolicy?: "redact-secrets" | "replace-identifiers" | "full";
    idempotencyKey: string;
  }) {
    this.snapshotCalls.push({
      sourceEnvironmentId: request.sourceEnvironmentId,
      targetEnvironmentId: request.targetEnvironmentId,
      idempotencyKey: request.idempotencyKey,
    });
    if (this.snapshotError) throw this.snapshotError;
    return {
      backupReference: `backup-${request.targetEnvironmentId}-${request.idempotencyKey}`,
      checksum: `checksum-${request.targetEnvironmentId}-${request.idempotencyKey}`,
      providerOperationId: `snapshot-operation-${request.idempotencyKey}`,
    };
  }

  async verifySnapshot(request: {
    tenantId: number;
    environmentId: number;
    backupReference: string;
    checksum: string;
    idempotencyKey: string;
  }): Promise<ProviderVerificationResult> {
    const refreshKey = request.idempotencyKey.replace(/:verify$/, "");
    if (this.snapshotStatusRaceKeys.has(refreshKey)) {
      await db.update(environmentSnapshotsTable).set({
        status: "failed",
        verificationDetails: { verified: false, error: "concurrent verification failure" },
      }).where(and(
        eq(environmentSnapshotsTable.environmentId, request.environmentId),
        eq(environmentSnapshotsTable.idempotencyKey, refreshKey),
      ));
    }
    if (this.refreshVerificationMode === "not-sanitized") {
      return { verified: true, healthy: true, sanitized: false, sanitizationPolicy: "redact-secrets" };
    }
    if (this.refreshVerificationMode === "wrong-policy") {
      return { verified: true, healthy: true, sanitized: true, sanitizationPolicy: "full" };
    }
    return { verified: true, healthy: true, sanitized: true, sanitizationPolicy: "redact-secrets" };
  }

  async restoreSnapshot(request: {
    tenantId: number;
    targetEnvironmentId: number;
    backupReference: string;
    idempotencyKey: string;
  }): Promise<RestoreOperation> {
    this.restoreCalls.push({
      targetEnvironmentId: request.targetEnvironmentId,
      idempotencyKey: request.idempotencyKey,
    });
    if (this.restoreStartError) throw this.restoreStartError;
    if (this.restoreMode === "throw") throw new Error("provider restore failure");
    return {
      providerOperationId: `restore-operation-${request.idempotencyKey}`,
      status: this.restoreMode === "success" ? "succeeded" : this.restoreMode,
      ...(this.restoreMode === "failed" ? { error: "provider restore rejected" } : {}),
    };
  }

  async getRestoreOperation(request: {
    tenantId: number;
    targetEnvironmentId: number;
    providerOperationId: string;
  }): Promise<RestoreOperation> {
    if (this.restorePollError) throw this.restorePollError;
    if (this.restoreMode === "throw") throw new Error("provider restore status failure");
    return {
      providerOperationId: request.providerOperationId,
      status: this.restoreMode === "success" ? "succeeded" : this.restoreMode,
      ...(this.restoreMode === "failed" ? { error: "provider restore rejected" } : {}),
    };
  }

  async verifyRestoredTarget(): Promise<ProviderVerificationResult> {
    if (this.restoreVerifyError) throw this.restoreVerifyError;
    if (this.restoreMode !== "success") throw new Error("restored target was not verified");
    return { verified: true, healthy: true };
  }
}

const provider = new InMemoryProvisioningProvider();

before(async () => {
  const [tenantA, tenantB] = await db.insert(tenantsTable).values([
    { name: "Provisioning Integration A", slug: `platform-provisioning-a-${runId}` },
    { name: "Provisioning Integration B", slug: `platform-provisioning-b-${runId}` },
  ]).returning();
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  const [production, dtd, otherTenantDtd, failed] = await db.insert(environmentsTable).values([
    { tenantId: tenantAId, name: "Production", slug: `provisioning-production-${runId}`, kind: "production", status: "active" },
    { tenantId: tenantAId, name: "Development / Test / Demo", slug: `provisioning-dtd-${runId}`, kind: "dtd", status: "active" },
    { tenantId: tenantBId, name: "Development / Test / Demo", slug: `provisioning-dtd-b-${runId}`, kind: "dtd", status: "active" },
    { tenantId: tenantAId, name: "Retry Environment", slug: `provisioning-retry-${runId}`, kind: "dtd", status: "active" },
  ]).returning();
  productionAId = production.id;
  dtdAId = dtd.id;
  dtdBId = otherTenantDtd.id;
  failureEnvironmentId = failed.id;

  const [admin] = await db.insert(usersTable).values({
    clerkUserId,
    email: `${clerkUserId}@integration.test`,
    displayName: "Platform Provisioning Admin",
    isPlatformAdmin: true,
  }).returning();
  platformAdminId = admin.id;
  await db.insert(membershipsTable).values({
    tenantId: tenantAId,
    userId: platformAdminId,
    role: "owner",
    environmentAccessConfigured: true,
  });
  await db.insert(userTenantContextTable).values({
    userId: platformAdminId,
    activeTenantId: tenantAId,
    activeEnvironmentId: dtdAId,
  });

  configureProvisioningProvider(provider);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (releaseId) await db.delete(platformReleasesTable).where(eq(platformReleasesTable.id, releaseId));
  if (tenantAId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantAId));
  if (tenantBId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantBId));
  if (platformAdminId) await db.delete(usersTable).where(eq(usersTable.id, platformAdminId));
  await pool.end();
});

test("provisions every isolated resource, persists audit records, and safely replays", async () => {
  const first = await request(`/platform/environments/${dtdAId}/provision`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `provision-success-${runId}` }),
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal((first.body as { executionContextReady: boolean }).executionContextReady, true);

  const resources = await db.select().from(environmentResourcesTable)
    .where(eq(environmentResourcesTable.environmentId, dtdAId));
  const operations = await db.select().from(provisioningOperationsTable)
    .where(and(eq(provisioningOperationsTable.environmentId, dtdAId), eq(provisioningOperationsTable.operationType, "provision")));
  const events = await db.select().from(provisioningEventsTable)
    .where(eq(provisioningEventsTable.environmentId, dtdAId));
  assert.equal(resources.length, resourceTypes.length);
  assert.equal(resources.every((resource) => resource.status === "ready"), true);
  assert.equal(operations.length, resourceTypes.length);
  assert.equal(operations.every((operation) => operation.status === "succeeded"), true);
  assert.equal(events.length, resourceTypes.length);
  assert.equal(events.every((event) => event.action === "provisioned" && event.operationId !== null && event.resourceId !== null), true);
  const runtime = resources.find((resource) => resource.resourceType === "runtime");
  assert.equal(runtime?.metadata && "token" in runtime.metadata, false);
  assert.equal(runtime?.metadata && "nested" in runtime.metadata &&
    typeof runtime.metadata.nested === "object" &&
    runtime.metadata.nested !== null &&
    "signingKey" in runtime.metadata.nested, false);

  const replay = await request(`/platform/environments/${dtdAId}/provision`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `provision-success-${runId}` }),
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  const replayOperations = await db.select().from(provisioningOperationsTable)
    .where(and(eq(provisioningOperationsTable.environmentId, dtdAId), eq(provisioningOperationsTable.operationType, "provision")));
  assert.equal(replayOperations.length, resourceTypes.length);
  assert.equal(provider.provisionCalls.filter((call) => call.environmentId === dtdAId).length, resourceTypes.length);
});

test("records a resource failure and permits a successful retry with a new idempotency key", async () => {
  provider.failProvisionFor.add(`${failureEnvironmentId}:database`);
  const failedKey = `provision-failure-${runId}`;
  const failed = await request(`/platform/environments/${failureEnvironmentId}/provision`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: failedKey }),
  });
  assert.equal(failed.status, 503, JSON.stringify(failed.body));
  const failedResource = await db.select().from(environmentResourcesTable).where(and(
    eq(environmentResourcesTable.environmentId, failureEnvironmentId),
    eq(environmentResourcesTable.resourceType, "database"),
  ));
  assert.equal(failedResource[0]?.status, "failed");
  assert.match(failedResource[0]?.lastError ?? "", /provider resource failure/);
  const failedOperation = await db.select().from(provisioningOperationsTable).where(and(
    eq(provisioningOperationsTable.environmentId, failureEnvironmentId),
    eq(provisioningOperationsTable.operationType, "provision"),
    eq(provisioningOperationsTable.idempotencyKey, `${failedKey}:database`),
  ));
  assert.equal(failedOperation[0]?.status, "failed");
  const failedEvent = await db.select().from(provisioningEventsTable).where(and(
    eq(provisioningEventsTable.environmentId, failureEnvironmentId),
    eq(provisioningEventsTable.action, "provision_failed"),
  ));
  assert.equal(failedEvent.length, 1);
  assert.equal(failedEvent[0]?.operationId, failedOperation[0]?.id);

  const providerCallsBeforeReplay = provider.provisionCalls.filter(
    (call) => call.environmentId === failureEnvironmentId,
  ).length;
  const failedReplay = await request(`/platform/environments/${failureEnvironmentId}/provision`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: failedKey }),
  });
  assert.equal(failedReplay.status, 503, JSON.stringify(failedReplay.body));
  const replayedFailedOperations = await db.select().from(provisioningOperationsTable).where(and(
    eq(provisioningOperationsTable.environmentId, failureEnvironmentId),
    eq(provisioningOperationsTable.operationType, "provision"),
    eq(provisioningOperationsTable.idempotencyKey, `${failedKey}:database`),
  ));
  assert.equal(replayedFailedOperations.length, 1);
  assert.equal(
    provider.provisionCalls.filter((call) => call.environmentId === failureEnvironmentId).length,
    providerCallsBeforeReplay,
  );

  provider.failProvisionFor.clear();
  const retry = await request(`/platform/environments/${failureEnvironmentId}/provision`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `provision-retry-${runId}` }),
  });
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  const retryResources = await db.select().from(environmentResourcesTable)
    .where(eq(environmentResourcesTable.environmentId, failureEnvironmentId));
  assert.equal(retryResources.every((resource) => resource.status === "ready"), true);
});

test("refreshes only within a tenant, sanitizes and verifies the snapshot, and restores it", async () => {
  const refresh = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: `refresh-success-${runId}`,
    }),
  });
  assert.equal(refresh.status, 201, JSON.stringify(refresh.body));
  const refreshBody = refresh.body as { refresh: { id: number; status: string }; snapshot: { id: number; status: string; sanitized: string; sanitizationPolicy: string; verificationDetails: Record<string, unknown> }; operationId: number };
  assert.equal(refreshBody.refresh.status, "completed");
  assert.equal(refreshBody.snapshot.status, "verified");
  assert.equal(refreshBody.snapshot.sanitized, "sanitized");
  assert.equal(refreshBody.snapshot.sanitizationPolicy, "redact-secrets");
  assert.equal(refreshBody.snapshot.verificationDetails.verified, true);
  const [refreshRow] = await db.select().from(environmentRefreshesTable).where(eq(environmentRefreshesTable.id, refreshBody.refresh.id));
  const [refreshOperation] = await db.select().from(provisioningOperationsTable).where(eq(provisioningOperationsTable.id, refreshBody.operationId));
  const [preparationOperation] = await db.select().from(provisioningOperationsTable).where(and(
    eq(provisioningOperationsTable.environmentId, dtdAId),
    eq(provisioningOperationsTable.operationType, "snapshot_prepare"),
    eq(provisioningOperationsTable.idempotencyKey, `refresh-success-${runId}`),
  ));
  assert.equal(refreshRow?.status, "completed");
  assert.equal(refreshOperation?.status, "succeeded");
  assert.equal(preparationOperation?.status, "succeeded");
  const refreshEvents = await db.select().from(provisioningEventsTable).where(eq(provisioningEventsTable.environmentId, dtdAId));
  assert.equal(refreshEvents.some((event) => event.action === "refresh_completed"), true);

  const replay = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: `refresh-success-${runId}`,
    }),
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));

  const crossTenant = await request(`/platform/environments/${dtdBId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "full",
      idempotencyKey: `refresh-cross-tenant-${runId}`,
    }),
  });
  assert.equal(crossTenant.status, 409);
  assert.match(String((crossTenant.body as { error: string }).error), /customer boundaries/);
});

test("fails refresh verification when sanitization is not explicitly confirmed", async () => {
  const restoreCallsBefore = provider.restoreCalls.length;
  provider.refreshVerificationMode = "wrong-policy";
  const failed = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: `refresh-invalid-verification-${runId}`,
    }),
  });
  provider.refreshVerificationMode = "valid";
  assert.equal(failed.status, 502, JSON.stringify(failed.body));
  const failedBody = failed.body as {
    refresh: { id: number };
    snapshot: { id: number };
  };
  const [snapshot] = await db.select().from(environmentSnapshotsTable)
    .where(eq(environmentSnapshotsTable.id, failedBody.snapshot.id));
  const [refresh] = await db.select().from(environmentRefreshesTable)
    .where(eq(environmentRefreshesTable.id, failedBody.refresh.id));
  assert.equal(snapshot?.status, "failed");
  assert.equal(refresh?.status, "failed");
  assert.equal(provider.restoreCalls.length, restoreCallsBefore);
  const restoreOperations = await db.select().from(provisioningOperationsTable).where(and(
    eq(provisioningOperationsTable.environmentId, dtdAId),
    eq(provisioningOperationsTable.operationType, "refresh"),
    eq(provisioningOperationsTable.idempotencyKey, `refresh-invalid-verification-${runId}:restore`),
  ));
  assert.equal(restoreOperations.length, 0);
  const preparationOperations = await db.select().from(provisioningOperationsTable).where(and(
    eq(provisioningOperationsTable.environmentId, dtdAId),
    eq(provisioningOperationsTable.operationType, "snapshot_prepare"),
    eq(provisioningOperationsTable.idempotencyKey, `refresh-invalid-verification-${runId}`),
  ));
  assert.equal(preparationOperations[0]?.status, "failed");
  const preparationFailureEvents = await db.select().from(provisioningEventsTable).where(and(
    eq(provisioningEventsTable.environmentId, dtdAId),
    eq(provisioningEventsTable.operationId, preparationOperations[0]?.id ?? -1),
    eq(provisioningEventsTable.action, "refresh_failed"),
  ));
  assert.equal(preparationFailureEvents.length, 1);
  const replay = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: `refresh-invalid-verification-${runId}`,
    }),
  });
  assert.equal(replay.status, 502, JSON.stringify(replay.body));
  assert.equal(provider.restoreCalls.length, restoreCallsBefore);
});

test("retries an ambiguous snapshot provider outage without terminally failing the refresh", async () => {
  const key = `refresh-retryable-snapshot-${runId}`;
  provider.snapshotError = new ProvisioningProviderRequestError("provider temporarily unavailable", 503);
  const interrupted = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: key,
    }),
  });
  provider.snapshotError = undefined;
  assert.equal(interrupted.status, 202, JSON.stringify(interrupted.body));
  const [preparation] = await db.select().from(provisioningOperationsTable).where(and(
    eq(provisioningOperationsTable.environmentId, dtdAId),
    eq(provisioningOperationsTable.operationType, "snapshot_prepare"),
    eq(provisioningOperationsTable.idempotencyKey, key),
  ));
  assert.equal(preparation?.status, "running");
  await db.update(provisioningOperationsTable).set({
    startedAt: new Date(Date.now() - 120_000),
  }).where(eq(provisioningOperationsTable.id, preparation.id));
  const replay = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: key,
    }),
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
});

test("rejects a refresh when its key belongs to a normal backup snapshot", async () => {
  const key = `refresh-backup-key-collision-${runId}`;
  const backup = await request(`/platform/environments/${dtdAId}/snapshots`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: key }),
  });
  assert.equal(backup.status, 201, JSON.stringify(backup.body));
  const backupSnapshotId = (backup.body as { id: number }).id;
  const restoreCallsBefore = provider.restoreCalls.length;
  const refresh = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: key,
    }),
  });
  assert.equal(refresh.status, 409, JSON.stringify(refresh.body));
  assert.equal(provider.restoreCalls.length, restoreCallsBefore);
  const refreshBody = refresh.body as { refreshId: number; snapshotId: number };
  assert.notEqual(refreshBody.refreshId, undefined);
  assert.equal(refreshBody.snapshotId, backupSnapshotId);
  const [backupSnapshot] = await db.select().from(environmentSnapshotsTable)
    .where(eq(environmentSnapshotsTable.id, backupSnapshotId));
  assert.equal(backupSnapshot?.kind, "backup");
  assert.equal(backupSnapshot?.status, "verified");
  const [failedRefresh] = await db.select().from(environmentRefreshesTable)
    .where(eq(environmentRefreshesTable.id, refreshBody.refreshId));
  assert.equal(failedRefresh?.status, "failed");
});

test("fails preparation if snapshot status changes while provider verification is in flight", async () => {
  const key = `refresh-snapshot-race-${runId}`;
  provider.snapshotStatusRaceKeys.add(key);
  const restoreCallsBefore = provider.restoreCalls.length;
  const response = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: key,
    }),
  });
  provider.snapshotStatusRaceKeys.delete(key);
  assert.equal(response.status, 502, JSON.stringify(response.body));
  const [preparation] = await db.select().from(provisioningOperationsTable).where(and(
    eq(provisioningOperationsTable.environmentId, dtdAId),
    eq(provisioningOperationsTable.operationType, "snapshot_prepare"),
    eq(provisioningOperationsTable.idempotencyKey, key),
  ));
  assert.equal(preparation?.status, "failed");
  const restoreOperations = await db.select().from(provisioningOperationsTable).where(and(
    eq(provisioningOperationsTable.environmentId, dtdAId),
    eq(provisioningOperationsTable.operationType, "refresh"),
    eq(provisioningOperationsTable.idempotencyKey, `${key}:restore`),
  ));
  assert.equal(restoreOperations.length, 0);
  assert.equal(provider.restoreCalls.length, restoreCallsBefore);
});

test("replays a pending refresh by reconciling its existing restore operation", async () => {
  provider.restoreMode = "pending";
  const key = `refresh-pending-${runId}`;
  const first = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: key,
    }),
  });
  assert.equal(first.status, 202, JSON.stringify(first.body));
  const callsAfterStart = provider.restoreCalls.length;
  const replayPending = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: key,
    }),
  });
  provider.restoreMode = "success";
  assert.equal(replayPending.status, 202, JSON.stringify(replayPending.body));
  assert.equal(provider.restoreCalls.length, callsAfterStart);

  const completed = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: key,
    }),
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal((completed.body as { refresh: { status: string } }).refresh.status, "completed");
});

test("claims a missing refresh restore operation when replaying a verified durable row", async () => {
  const key = `refresh-missing-operation-${runId}`;
  const [snapshot] = await db.insert(environmentSnapshotsTable).values({
    tenantId: tenantAId,
    environmentId: dtdAId,
    sourceEnvironmentId: productionAId,
    idempotencyKey: key,
    kind: "refresh",
    status: "verified",
    sanitized: "sanitized",
    sanitizationPolicy: "redact-secrets",
    backupReference: `missing-operation-backup-${runId}`,
    checksum: `missing-operation-checksum-${runId}`,
    verificationDetails: { verified: true, sanitized: true, sanitizationPolicy: "redact-secrets" },
    createdByUserId: platformAdminId,
    verifiedAt: new Date(),
  }).returning();
  await db.insert(environmentRefreshesTable).values({
    tenantId: tenantAId,
    sourceEnvironmentId: productionAId,
    targetEnvironmentId: dtdAId,
    snapshotId: snapshot.id,
    idempotencyKey: key,
    status: "running",
    sanitizationPolicy: "redact-secrets",
    requestedByUserId: platformAdminId,
    startedAt: new Date(),
  });
  const replay = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: key,
    }),
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  const operationId = (replay.body as { operationId: number }).operationId;
  const [operation] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, operationId));
  assert.equal(operation?.status, "succeeded");
  const [preparation] = await db.select().from(provisioningOperationsTable).where(and(
    eq(provisioningOperationsTable.environmentId, dtdAId),
    eq(provisioningOperationsTable.operationType, "snapshot_prepare"),
    eq(provisioningOperationsTable.idempotencyKey, key),
  ));
  assert.equal(preparation?.status, "succeeded");
});

test("reclaims a stale snapshot preparation lease after a post-claim crash", async () => {
  const key = `refresh-stale-preparation-${runId}`;
  const [snapshot] = await db.insert(environmentSnapshotsTable).values({
    tenantId: tenantAId,
    environmentId: dtdAId,
    sourceEnvironmentId: productionAId,
    idempotencyKey: key,
    kind: "refresh",
    status: "running",
    sanitized: "pending",
    sanitizationPolicy: "redact-secrets",
    createdByUserId: platformAdminId,
  }).returning();
  const [refresh] = await db.insert(environmentRefreshesTable).values({
    tenantId: tenantAId,
    sourceEnvironmentId: productionAId,
    targetEnvironmentId: dtdAId,
    snapshotId: snapshot.id,
    idempotencyKey: key,
    status: "running",
    sanitizationPolicy: "redact-secrets",
    requestedByUserId: platformAdminId,
    startedAt: new Date(Date.now() - 120_000),
  }).returning();
  const [preparation] = await db.insert(provisioningOperationsTable).values({
    tenantId: tenantAId,
    environmentId: dtdAId,
    operationType: "snapshot_prepare",
    idempotencyKey: key,
    status: "running",
    details: {
      refreshId: refresh.id,
      snapshotId: snapshot.id,
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
    },
    requestedByUserId: platformAdminId,
    startedAt: new Date(),
  }).returning();
  const snapshotCallsBefore = provider.snapshotCalls.length;
  const activeLease = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: key,
    }),
  });
  assert.equal(activeLease.status, 202, JSON.stringify(activeLease.body));
  assert.equal(provider.snapshotCalls.length, snapshotCallsBefore);
  await db.update(provisioningOperationsTable).set({
    startedAt: new Date(Date.now() - 120_000),
  }).where(eq(provisioningOperationsTable.id, preparation.id));
  await reconcileProvisioningRecoverySweep();
  await reconcileProvisioningRecoverySweep();
  assert.equal(provider.snapshotCalls.length, snapshotCallsBefore + 1);
  assert.equal(provider.snapshotCalls.at(-1)?.idempotencyKey, key);
  const [updatedPreparation] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, preparation.id));
  assert.equal(updatedPreparation?.status, "succeeded");
  const [updatedSnapshot] = await db.select().from(environmentSnapshotsTable)
    .where(eq(environmentSnapshotsTable.id, snapshot.id));
  assert.equal(updatedSnapshot?.status, "verified");
  const [updatedRefresh] = await db.select().from(environmentRefreshesTable)
    .where(eq(environmentRefreshesTable.id, refresh.id));
  assert.equal(updatedRefresh?.status, "completed");
});

test("repairs an interrupted preparation failure through the recovery sweep", async () => {
  const key = `refresh-failed-repair-${runId}`;
  const [snapshot] = await db.insert(environmentSnapshotsTable).values({
    tenantId: tenantAId,
    environmentId: dtdAId,
    sourceEnvironmentId: productionAId,
    idempotencyKey: key,
    kind: "refresh",
    status: "running",
    sanitized: "pending",
    sanitizationPolicy: "redact-secrets",
    createdByUserId: platformAdminId,
  }).returning();
  const [refresh] = await db.insert(environmentRefreshesTable).values({
    tenantId: tenantAId,
    sourceEnvironmentId: productionAId,
    targetEnvironmentId: dtdAId,
    snapshotId: snapshot.id,
    idempotencyKey: key,
    status: "running",
    sanitizationPolicy: "redact-secrets",
    requestedByUserId: platformAdminId,
  }).returning();
  const [preparation] = await db.insert(provisioningOperationsTable).values({
    tenantId: tenantAId,
    environmentId: dtdAId,
    operationType: "snapshot_prepare",
    idempotencyKey: key,
    status: "failed",
    error: "interrupted preparation failure",
    completedAt: new Date(),
    details: {
      refreshId: refresh.id,
      snapshotId: snapshot.id,
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
    },
    requestedByUserId: platformAdminId,
  }).returning();

  let repairedSnapshot;
  let repairedRefresh;
  for (let index = 0; index < 20; index += 1) {
    await reconcileProvisioningRecoverySweep();
    [repairedSnapshot] = await db.select().from(environmentSnapshotsTable)
      .where(eq(environmentSnapshotsTable.id, snapshot.id));
    [repairedRefresh] = await db.select().from(environmentRefreshesTable)
      .where(eq(environmentRefreshesTable.id, refresh.id));
    if (repairedSnapshot?.status === "failed" && repairedRefresh?.status === "failed") break;
  }
  const failureEvents = await db.select().from(provisioningEventsTable).where(and(
    eq(provisioningEventsTable.operationId, preparation.id),
    eq(provisioningEventsTable.action, "refresh_failed"),
  ));
  assert.equal(repairedSnapshot?.status, "failed");
  assert.equal(repairedRefresh?.status, "failed");
  assert.equal(failureEvents.length, 1);
});

test("repairs legacy partial terminal restore, refresh, and rollback rows without duplicate events", async () => {
  const successKey = `terminal-success-refresh-${runId}`;
  const failureKey = `terminal-failed-refresh-${runId}`;
  const restoreKey = `terminal-failed-restore-${runId}`;
  const rollbackKey = `terminal-success-rollback-${runId}`;
  const [successSnapshot, failureSnapshot, restoreSnapshot, rollbackSnapshot] = await db.insert(environmentSnapshotsTable).values([
    {
      tenantId: tenantAId, environmentId: dtdAId, sourceEnvironmentId: productionAId,
      idempotencyKey: successKey, kind: "refresh", status: "verified", sanitized: "sanitized",
      sanitizationPolicy: "redact-secrets", backupReference: `backup-${successKey}`, checksum: `checksum-${successKey}`,
      verificationDetails: { verified: true, sanitized: true, sanitizationPolicy: "redact-secrets" },
      createdByUserId: platformAdminId, verifiedAt: new Date(),
    },
    {
      tenantId: tenantAId, environmentId: dtdAId, sourceEnvironmentId: productionAId,
      idempotencyKey: failureKey, kind: "refresh", status: "verified", sanitized: "sanitized",
      sanitizationPolicy: "redact-secrets", backupReference: `backup-${failureKey}`, checksum: `checksum-${failureKey}`,
      verificationDetails: { verified: true, sanitized: true, sanitizationPolicy: "redact-secrets" },
      createdByUserId: platformAdminId, verifiedAt: new Date(),
    },
    {
      tenantId: tenantAId, environmentId: dtdAId, idempotencyKey: restoreKey,
      kind: "backup", status: "verified", sanitized: "not_applicable",
      backupReference: `backup-${restoreKey}`, checksum: `checksum-${restoreKey}`,
      verificationDetails: { verified: true }, createdByUserId: platformAdminId, verifiedAt: new Date(),
    },
    {
      tenantId: tenantAId, environmentId: dtdAId, idempotencyKey: rollbackKey,
      kind: "backup", status: "verified", sanitized: "not_applicable",
      backupReference: `backup-${rollbackKey}`, checksum: `checksum-${rollbackKey}`,
      verificationDetails: { verified: true }, createdByUserId: platformAdminId, verifiedAt: new Date(),
    },
  ]).returning();
  const [successRefresh, failureRefresh] = await db.insert(environmentRefreshesTable).values([
    {
      tenantId: tenantAId, sourceEnvironmentId: productionAId, targetEnvironmentId: dtdAId,
      snapshotId: successSnapshot.id, idempotencyKey: successKey, status: "running",
      sanitizationPolicy: "redact-secrets", requestedByUserId: platformAdminId,
    },
    {
      tenantId: tenantAId, sourceEnvironmentId: productionAId, targetEnvironmentId: dtdAId,
      snapshotId: failureSnapshot.id, idempotencyKey: failureKey, status: "running",
      sanitizationPolicy: "redact-secrets", requestedByUserId: platformAdminId,
    },
  ]).returning();
  const [release] = await db.insert(platformReleasesTable).values({
    releaseType: "platform", status: "released", version: `terminal-repair-${runId}`,
    appPayload: "{}", configPayload: "{}", mandatory: true, createdByUserId: platformAdminId,
  }).returning();
  const [assignment] = await db.insert(environmentReleaseAssignmentsTable).values({
    environmentId: dtdAId, releaseId: release.id, assignedByUserId: platformAdminId,
    status: "deployed", deploymentStatus: "deployed",
  }).returning();
  await db.insert(environmentReleaseControlsTable).values({
    assignmentId: assignment.id, snapshotId: rollbackSnapshot.id,
    rollbackSnapshotId: rollbackSnapshot.id, rollbackStatus: "available",
  });
  const oldCompletedAt = new Date(Date.now() - 120_000);
  const newCompletedAt = new Date();
  const [
    olderFailedRefreshOperation,
    succeededRefreshOperation,
    failedRefreshOperation,
    failedRestoreOperation,
    olderFailedRollbackOperation,
    succeededRollbackOperation,
  ] =
    await db.insert(provisioningOperationsTable).values([
      {
        tenantId: tenantAId, environmentId: dtdAId, operationType: "refresh",
        idempotencyKey: `${successKey}:older-failed`, status: "failed", error: "older refresh failure",
        completedAt: oldCompletedAt, details: { refreshId: successRefresh.id, snapshotId: successSnapshot.id },
        requestedByUserId: platformAdminId,
      },
      {
        tenantId: tenantAId, environmentId: dtdAId, operationType: "refresh",
        idempotencyKey: `${successKey}:restore`, status: "succeeded", completedAt: newCompletedAt,
        details: { refreshId: successRefresh.id, snapshotId: successSnapshot.id },
        requestedByUserId: platformAdminId,
      },
      {
        tenantId: tenantAId, environmentId: dtdAId, operationType: "refresh",
        idempotencyKey: `${failureKey}:restore`, status: "failed", error: "legacy refresh failure",
        completedAt: new Date(), details: { refreshId: failureRefresh.id, snapshotId: failureSnapshot.id },
        requestedByUserId: platformAdminId,
      },
      {
        tenantId: tenantAId, environmentId: dtdAId, operationType: "restore",
        idempotencyKey: restoreKey, status: "failed", error: "legacy restore failure",
        completedAt: new Date(), details: { snapshotId: restoreSnapshot.id },
        requestedByUserId: platformAdminId,
      },
      {
        tenantId: tenantAId, environmentId: dtdAId, operationType: "rollback",
        idempotencyKey: `${rollbackKey}:older-failed`, status: "failed", error: "older rollback failure",
        completedAt: oldCompletedAt,
        details: { assignmentId: assignment.id, snapshotId: rollbackSnapshot.id, rollback: true, releaseRollback: true },
        requestedByUserId: platformAdminId,
      },
      {
        tenantId: tenantAId, environmentId: dtdAId, operationType: "rollback",
        idempotencyKey: rollbackKey, status: "succeeded", completedAt: newCompletedAt,
        details: { assignmentId: assignment.id, snapshotId: rollbackSnapshot.id, rollback: true, releaseRollback: true },
        requestedByUserId: platformAdminId,
      },
    ]).returning();

  const resourceStatesBefore = await db.select({
    id: environmentResourcesTable.id,
    status: environmentResourcesTable.status,
    lastError: environmentResourcesTable.lastError,
  }).from(environmentResourcesTable).where(eq(environmentResourcesTable.environmentId, dtdAId));
  for (let index = 0; index < 10; index += 1) await reconcileProvisioningRecoverySweep();
  const [repairedSuccessRefresh] = await db.select().from(environmentRefreshesTable)
    .where(eq(environmentRefreshesTable.id, successRefresh.id));
  const [repairedFailureRefresh] = await db.select().from(environmentRefreshesTable)
    .where(eq(environmentRefreshesTable.id, failureRefresh.id));
  const [repairedFailureSnapshot] = await db.select().from(environmentSnapshotsTable)
    .where(eq(environmentSnapshotsTable.id, failureSnapshot.id));
  const [repairedControl] = await db.select().from(environmentReleaseControlsTable)
    .where(eq(environmentReleaseControlsTable.assignmentId, assignment.id));
  const currentResources = await db.select({
    id: environmentResourcesTable.id,
    status: environmentResourcesTable.status,
    lastError: environmentResourcesTable.lastError,
  }).from(environmentResourcesTable)
    .where(eq(environmentResourcesTable.environmentId, dtdAId));
  assert.equal(repairedSuccessRefresh?.status, "completed");
  assert.equal(repairedFailureRefresh?.status, "failed");
  assert.equal(repairedFailureSnapshot?.status, "failed");
  assert.equal(repairedControl?.rollbackStatus, "completed");
  assert.deepEqual(currentResources, resourceStatesBefore);

  for (const [operation, action] of [
    [olderFailedRefreshOperation, "refresh_failed"],
    [succeededRefreshOperation, "refresh_completed"],
    [failedRefreshOperation, "refresh_failed"],
    [failedRestoreOperation, "restore_failed"],
    [olderFailedRollbackOperation, "release_rollback_failed"],
    [succeededRollbackOperation, "rollback_completed"],
  ] as const) {
    const events = await db.select().from(provisioningEventsTable).where(and(
      eq(provisioningEventsTable.operationId, operation.id),
      eq(provisioningEventsTable.action, action),
    ));
    assert.equal(events.length, 1, `${action} should be repaired exactly once`);
  }
  const stableFailureCompletedAt = repairedFailureRefresh?.completedAt?.getTime();
  for (let index = 0; index < 10; index += 1) await reconcileProvisioningRecoverySweep();
  const [stillSuccessfulRefresh] = await db.select().from(environmentRefreshesTable)
    .where(eq(environmentRefreshesTable.id, successRefresh.id));
  const [stillFailedRefresh] = await db.select().from(environmentRefreshesTable)
    .where(eq(environmentRefreshesTable.id, failureRefresh.id));
  const [stillCompletedControl] = await db.select().from(environmentReleaseControlsTable)
    .where(eq(environmentReleaseControlsTable.assignmentId, assignment.id));
  assert.equal(stillSuccessfulRefresh?.status, "completed");
  assert.equal(stillFailedRefresh?.completedAt?.getTime(), stableFailureCompletedAt);
  assert.equal(stillCompletedControl?.rollbackStatus, "completed");
  await db.delete(environmentReleaseAssignmentsTable).where(eq(environmentReleaseAssignmentsTable.id, assignment.id));
  await db.delete(platformReleasesTable).where(eq(platformReleasesTable.id, release.id));
});

test("keeps a completed provider restore recoverable when its audit transaction fails", async () => {
  const key = `refresh-audit-transaction-${runId}`;
  const functionName = `test_fail_refresh_event_${process.pid}`;
  const triggerName = `test_fail_refresh_event_trigger_${process.pid}`;
  await pool.query(`CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.tenant_id = ${tenantAId} AND NEW.action = 'refresh_completed' THEN
        RAISE EXCEPTION 'intentional refresh audit failure';
      END IF;
      RETURN NEW;
    END;
    $$`);
  await pool.query(`CREATE TRIGGER ${triggerName}
    BEFORE INSERT ON provisioning_events
    FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
  let interrupted;
  try {
    interrupted = await request(`/platform/environments/${dtdAId}/refresh`, {
      method: "POST",
      body: JSON.stringify({
        sourceEnvironmentId: productionAId,
        sanitizationPolicy: "redact-secrets",
        idempotencyKey: key,
      }),
    });
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON provisioning_events`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
  }
  assert.equal(interrupted?.status, 503, JSON.stringify(interrupted?.body));
  const interruptedBody = interrupted?.body as {
    refresh: { id: number; status: string };
    snapshot: { status: string };
    operationId: number;
  };
  assert.equal(interruptedBody.refresh.status, "running");
  assert.equal(interruptedBody.snapshot.status, "verified");
  const [operationBeforeReplay] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, interruptedBody.operationId));
  assert.equal(operationBeforeReplay?.status, "running");

  const replay = await request(`/platform/environments/${dtdAId}/refresh`, {
    method: "POST",
    body: JSON.stringify({
      sourceEnvironmentId: productionAId,
      sanitizationPolicy: "redact-secrets",
      idempotencyKey: key,
    }),
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  const [completedRefresh] = await db.select().from(environmentRefreshesTable)
    .where(eq(environmentRefreshesTable.id, interruptedBody.refresh.id));
  const [completedOperation] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, interruptedBody.operationId));
  const completionEvents = await db.select().from(provisioningEventsTable).where(and(
    eq(provisioningEventsTable.operationId, interruptedBody.operationId),
    eq(provisioningEventsTable.action, "refresh_completed"),
  ));
  assert.equal(completedRefresh?.status, "completed");
  assert.equal(completedOperation?.status, "succeeded");
  assert.equal(completionEvents.length, 1);
});

test("keeps a plain restore recoverable across audit and provider-ID persistence failures", async () => {
  const backup = await request(`/platform/environments/${dtdAId}/snapshots`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `restore-recovery-backup-${runId}` }),
  });
  assert.equal(backup.status, 201, JSON.stringify(backup.body));
  const snapshotId = (backup.body as { id: number }).id;

  const auditKey = `restore-audit-transaction-${runId}`;
  const auditFunction = `test_fail_restore_event_${process.pid}`;
  const auditTrigger = `test_fail_restore_event_trigger_${process.pid}`;
  await pool.query(`CREATE OR REPLACE FUNCTION ${auditFunction}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.tenant_id = ${tenantAId} AND NEW.action = 'restore_completed' THEN
        RAISE EXCEPTION 'intentional restore audit failure';
      END IF;
      RETURN NEW;
    END;
    $$`);
  await pool.query(`CREATE TRIGGER ${auditTrigger}
    BEFORE INSERT ON provisioning_events
    FOR EACH ROW EXECUTE FUNCTION ${auditFunction}()`);
  let interruptedAudit;
  try {
    interruptedAudit = await request(`/platform/snapshots/${snapshotId}/restore`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: auditKey }),
    });
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS ${auditTrigger} ON provisioning_events`);
    await pool.query(`DROP FUNCTION IF EXISTS ${auditFunction}()`);
  }
  assert.equal(interruptedAudit?.status, 503, JSON.stringify(interruptedAudit?.body));
  const auditOperationId = (interruptedAudit?.body as { operationId: number }).operationId;
  const [auditOperation] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, auditOperationId));
  assert.equal(auditOperation?.status, "running");
  const completedAuditReplay = await request(`/platform/snapshots/${snapshotId}/restore`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: auditKey }),
  });
  assert.equal(completedAuditReplay.status, 200, JSON.stringify(completedAuditReplay.body));

  const persistenceKey = `restore-provider-id-persistence-${runId}`;
  const persistenceFunction = `test_fail_restore_running_${process.pid}`;
  const persistenceTrigger = `test_fail_restore_running_trigger_${process.pid}`;
  await pool.query(`CREATE OR REPLACE FUNCTION ${persistenceFunction}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.idempotency_key = '${persistenceKey}' AND
        OLD.status = 'requested' AND NEW.status = 'running' THEN
        RAISE EXCEPTION 'intentional provider operation ID persistence failure';
      END IF;
      RETURN NEW;
    END;
    $$`);
  await pool.query(`CREATE TRIGGER ${persistenceTrigger}
    BEFORE UPDATE ON provisioning_operations
    FOR EACH ROW EXECUTE FUNCTION ${persistenceFunction}()`);
  let interruptedPersistence;
  try {
    interruptedPersistence = await request(`/platform/snapshots/${snapshotId}/restore`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: persistenceKey }),
    });
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS ${persistenceTrigger} ON provisioning_operations`);
    await pool.query(`DROP FUNCTION IF EXISTS ${persistenceFunction}()`);
  }
  assert.equal(interruptedPersistence?.status, 202, JSON.stringify(interruptedPersistence?.body));
  const persistenceOperationId = (interruptedPersistence?.body as {
    operation: { id: number };
  }).operation.id;
  const [requestedOperation] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, persistenceOperationId));
  assert.equal(requestedOperation?.status, "requested");
  assert.equal(requestedOperation?.providerOperationId, null);
  await db.update(provisioningOperationsTable).set({
    startedAt: new Date(Date.now() - 120_000),
  }).where(eq(provisioningOperationsTable.id, persistenceOperationId));
  const completedPersistenceReplay = await request(`/platform/snapshots/${snapshotId}/restore`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: persistenceKey }),
  });
  assert.equal(completedPersistenceReplay.status, 200, JSON.stringify(completedPersistenceReplay.body));
  const persistenceCalls = provider.restoreCalls.filter((call) => call.idempotencyKey === persistenceKey);
  assert.equal(persistenceCalls.length, 2);
});

test("keeps ambiguous restore start, polling, and verification outages retryable", async () => {
  const backup = await request(`/platform/environments/${dtdAId}/snapshots`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `restore-retryable-backup-${runId}` }),
  });
  assert.equal(backup.status, 201, JSON.stringify(backup.body));
  const snapshotId = (backup.body as { id: number }).id;

  const startKey = `restore-retryable-start-${runId}`;
  provider.restoreStartError = new ProvisioningProviderRequestError("restore start timed out", 503);
  const interruptedStart = await request(`/platform/snapshots/${snapshotId}/restore`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: startKey }),
  });
  provider.restoreStartError = undefined;
  assert.equal(interruptedStart.status, 202, JSON.stringify(interruptedStart.body));
  const startOperationId = (interruptedStart.body as { operation: { id: number } }).operation.id;
  await db.update(provisioningOperationsTable).set({ startedAt: new Date(Date.now() - 120_000) })
    .where(eq(provisioningOperationsTable.id, startOperationId));
  const completedStart = await request(`/platform/snapshots/${snapshotId}/restore`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: startKey }),
  });
  assert.equal(completedStart.status, 200, JSON.stringify(completedStart.body));

  const pollKey = `restore-retryable-poll-${runId}`;
  provider.restoreMode = "pending";
  const pending = await request(`/platform/snapshots/${snapshotId}/restore`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: pollKey }),
  });
  assert.equal(pending.status, 202, JSON.stringify(pending.body));
  provider.restorePollError = new ProvisioningProviderRequestError("restore polling timed out", 503);
  const interruptedPoll = await request(`/platform/snapshots/${snapshotId}/restore`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: pollKey }),
  });
  provider.restorePollError = undefined;
  provider.restoreMode = "success";
  assert.equal(interruptedPoll.status, 202, JSON.stringify(interruptedPoll.body));
  const completedPoll = await request(`/platform/snapshots/${snapshotId}/restore`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: pollKey }),
  });
  assert.equal(completedPoll.status, 200, JSON.stringify(completedPoll.body));

  const verifyKey = `restore-retryable-verify-${runId}`;
  provider.restoreVerifyError = new ProvisioningProviderRequestError("restore verification unavailable", 503);
  const interruptedVerification = await request(`/platform/snapshots/${snapshotId}/restore`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: verifyKey }),
  });
  provider.restoreVerifyError = undefined;
  assert.equal(interruptedVerification.status, 202, JSON.stringify(interruptedVerification.body));
  const completedVerification = await request(`/platform/snapshots/${snapshotId}/restore`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: verifyKey }),
  });
  assert.equal(completedVerification.status, 200, JSON.stringify(completedVerification.body));
});

test("does not report restore success when the provider fails and audits the failure", async () => {
  const backup = await request(`/platform/environments/${dtdAId}/snapshots`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `restore-failure-backup-${runId}` }),
  });
  assert.equal(backup.status, 201, JSON.stringify(backup.body));
  const snapshotId = (backup.body as { id: number }).id;
  provider.restoreStartError = new ProvisioningProviderRequestError("provider restore rejected", 400);
  const restore = await request(`/platform/snapshots/${snapshotId}/restore`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `restore-failure-${runId}` }),
  });
  provider.restoreStartError = undefined;
  assert.equal(restore.status, 503, JSON.stringify(restore.body));
  const operationId = (restore.body as { operationId: number }).operationId;
  const [operation] = await db.select().from(provisioningOperationsTable).where(eq(provisioningOperationsTable.id, operationId));
  assert.equal(operation?.status, "failed");
  assert.notEqual(operation?.status, "succeeded");
  const restoreEvents = await db.select().from(provisioningEventsTable).where(and(
    eq(provisioningEventsTable.environmentId, dtdAId),
    eq(provisioningEventsTable.operationId, operationId),
  ));
  assert.equal(restoreEvents.some((event) => event.action === "restore_failed"), true);
  const degradedResources = await db.select().from(environmentResourcesTable)
    .where(eq(environmentResourcesTable.environmentId, dtdAId));
  assert.equal(degradedResources.every((resource) =>
    resource.status === "degraded" &&
    resource.lastError?.startsWith(`recovery-operation:${operationId}:`)), true);
  const blockedIsolation = await request(`/platform/environments/${dtdAId}/enforce-isolation`, { method: "POST" });
  assert.equal(blockedIsolation.status, 409, JSON.stringify(blockedIsolation.body));

  const recovery = await request(`/platform/snapshots/${snapshotId}/restore`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `restore-after-failure-${runId}` }),
  });
  assert.equal(recovery.status, 200, JSON.stringify(recovery.body));
  const recoveredResources = await db.select().from(environmentResourcesTable)
    .where(eq(environmentResourcesTable.environmentId, dtdAId));
  assert.equal(recoveredResources.every((resource) =>
    resource.status === "ready" && resource.lastError === null), true);
});

test("keeps release rollback failures auditable and updates release control", async () => {
  const [release] = await db.insert(platformReleasesTable).values({
    releaseType: "platform",
    status: "released",
    version: `rollback-${runId}`,
    appPayload: "{}",
    configPayload: "{}",
    mandatory: true,
    createdByUserId: platformAdminId,
  }).returning();
  releaseId = release.id;
  const [assignment] = await db.insert(environmentReleaseAssignmentsTable).values({
    environmentId: dtdAId,
    releaseId: release.id,
    assignedByUserId: platformAdminId,
    status: "deployed",
    deploymentStatus: "deployed",
  }).returning();
  const [snapshot] = await db.insert(environmentSnapshotsTable).values({
    tenantId: tenantAId,
    environmentId: dtdAId,
    idempotencyKey: `release-rollback-snapshot-${runId}`,
    kind: "backup",
    status: "verified",
    sanitized: "not_applicable",
    backupReference: `release-rollback-backup-${runId}`,
    checksum: `release-rollback-checksum-${runId}`,
    verificationDetails: { verified: true },
    createdByUserId: platformAdminId,
    verifiedAt: new Date(),
  }).returning();
  releaseAssignmentId = assignment.id;
  releaseRollbackSnapshotId = snapshot.id;
  await db.insert(environmentReleaseControlsTable).values({
    assignmentId: assignment.id,
    snapshotId: snapshot.id,
    rollbackSnapshotId: snapshot.id,
    rollbackStatus: "available",
  });

  provider.restoreMode = "failed";
  const rollback = await request(`/platform/release-assignments/${assignment.id}/rollback`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `release-rollback-failure-${runId}` }),
  });
  provider.restoreMode = "success";
  assert.equal(rollback.status, 502, JSON.stringify(rollback.body));
  const [control] = await db.select().from(environmentReleaseControlsTable)
    .where(eq(environmentReleaseControlsTable.assignmentId, releaseAssignmentId));
  assert.equal(control?.rollbackStatus, "failed");
  const [operation] = await db.select().from(provisioningOperationsTable).where(and(
    eq(provisioningOperationsTable.operationType, "rollback"),
    eq(provisioningOperationsTable.idempotencyKey, `release-rollback-failure-${runId}`),
  ));
  assert.equal(operation?.status, "failed");
  const rollbackEvents = await db.select().from(provisioningEventsTable).where(and(
    eq(provisioningEventsTable.environmentId, dtdAId),
    eq(provisioningEventsTable.operationId, operation?.id ?? -1),
  ));
  assert.equal(rollbackEvents.some((event) => event.action === "release_rollback_failed"), true);
  assert.equal(releaseRollbackSnapshotId > 0, true);

  await db.update(environmentReleaseControlsTable).set({ rollbackStatus: "available" })
    .where(eq(environmentReleaseControlsTable.assignmentId, assignment.id));
  const auditKey = `release-rollback-audit-${runId}`;
  const auditFunction = `test_fail_rollback_event_${process.pid}`;
  const auditTrigger = `test_fail_rollback_event_trigger_${process.pid}`;
  await pool.query(`CREATE OR REPLACE FUNCTION ${auditFunction}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.tenant_id = ${tenantAId} AND NEW.action = 'rollback_completed' THEN
        RAISE EXCEPTION 'intentional rollback audit failure';
      END IF;
      RETURN NEW;
    END;
    $$`);
  await pool.query(`CREATE TRIGGER ${auditTrigger}
    BEFORE INSERT ON provisioning_events
    FOR EACH ROW EXECUTE FUNCTION ${auditFunction}()`);
  let interruptedRollback;
  try {
    interruptedRollback = await request(`/platform/release-assignments/${assignment.id}/rollback`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: auditKey }),
    });
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS ${auditTrigger} ON provisioning_events`);
    await pool.query(`DROP FUNCTION IF EXISTS ${auditFunction}()`);
  }
  assert.equal(interruptedRollback?.status, 503, JSON.stringify(interruptedRollback?.body));
  const interruptedOperationId = (interruptedRollback?.body as { operationId: number }).operationId;
  const [interruptedOperation] = await db.select().from(provisioningOperationsTable)
    .where(eq(provisioningOperationsTable.id, interruptedOperationId));
  const [uncommittedControl] = await db.select().from(environmentReleaseControlsTable)
    .where(eq(environmentReleaseControlsTable.assignmentId, assignment.id));
  assert.equal(interruptedOperation?.status, "running");
  assert.equal(uncommittedControl?.rollbackStatus, "available");
  const completedRollback = await request(`/platform/release-assignments/${assignment.id}/rollback`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: auditKey }),
  });
  assert.equal(completedRollback.status, 200, JSON.stringify(completedRollback.body));
  const [completedControl] = await db.select().from(environmentReleaseControlsTable)
    .where(eq(environmentReleaseControlsTable.assignmentId, assignment.id));
  assert.equal(completedControl?.rollbackStatus, "completed");

  const [foreignSnapshot] = await db.insert(environmentSnapshotsTable).values({
    tenantId: tenantBId,
    environmentId: dtdBId,
    idempotencyKey: `foreign-rollback-snapshot-${runId}`,
    kind: "backup",
    status: "verified",
    sanitized: "not_applicable",
    backupReference: `foreign-rollback-backup-${runId}`,
    checksum: `foreign-rollback-checksum-${runId}`,
    verificationDetails: { verified: true },
    createdByUserId: platformAdminId,
    verifiedAt: new Date(),
  }).returning();
  await db.update(environmentReleaseControlsTable).set({
    rollbackSnapshotId: foreignSnapshot.id,
  }).where(eq(environmentReleaseControlsTable.assignmentId, releaseAssignmentId));
  const restoreCallsBeforeCrossEnvironment = provider.restoreCalls.length;
  const crossEnvironment = await request(`/platform/release-assignments/${releaseAssignmentId}/rollback`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `release-rollback-cross-environment-${runId}` }),
  });
  assert.equal(crossEnvironment.status, 409, JSON.stringify(crossEnvironment.body));
  assert.equal(provider.restoreCalls.length, restoreCallsBeforeCrossEnvironment);
});

test("records successful and failed health verification checks", async () => {
  provider.failVerification = false;
  const healthy = await request(`/platform/environments/${failureEnvironmentId}/verify`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `health-success-${runId}` }),
  });
  assert.equal(healthy.status, 200, JSON.stringify(healthy.body));
  assert.equal((healthy.body as { status: string }).status, "healthy");

  provider.failVerification = true;
  const unhealthy = await request(`/platform/environments/${failureEnvironmentId}/verify`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `health-failure-${runId}` }),
  });
  provider.failVerification = false;
  assert.equal(unhealthy.status, 503, JSON.stringify(unhealthy.body));
  assert.equal((unhealthy.body as { status: string }).status, "unhealthy");
  const checks = await db.select().from(environmentHealthChecksTable).where(eq(
    environmentHealthChecksTable.environmentId,
    failureEnvironmentId,
  ));
  assert.equal(checks.some((check) => check.status === "healthy"), true);
  assert.equal(checks.some((check) => check.status === "unhealthy"), true);
  const events = await db.select().from(provisioningEventsTable).where(and(
    eq(provisioningEventsTable.environmentId, failureEnvironmentId),
    eq(provisioningEventsTable.action, "environment_verified"),
  ));
  assert.equal(events.length >= 2, true);
});