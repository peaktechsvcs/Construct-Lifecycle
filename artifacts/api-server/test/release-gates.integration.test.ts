import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";

process.env.APP_ENV = "test";

const {
  db,
  environmentHealthChecksTable,
  environmentReleaseAssignmentsTable,
  environmentReleaseControlsTable,
  releaseAssignmentEventsTable,
  environmentResourcesTable,
  environmentSnapshotsTable,
  environmentsTable,
  membershipsTable,
  platformReleasesTable,
  pool,
  tenantEnvironmentAccessTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const { default: app } = await import("../src/app.ts");

type Json = Record<string, unknown> | unknown[];

const runId = `${Date.now()}-${process.pid}`;
const clerkIds = {
  platformAdmin: `release-platform-admin-${runId}`,
  ownerA: `release-owner-a-${runId}`,
  memberA: `release-member-a-${runId}`,
  ownerB: `release-owner-b-${runId}`,
};

const resourceTypes = ["runtime", "database", "storage", "queue", "secrets", "jobs", "logs"];

let server: Server;
let baseUrl = "";
let tenantAId: number;
let tenantBId: number;
let dtdAId: number;
let productionAId: number;
let dtdBId: number;
let platformAdminId: number;
let featureReleaseId: number;
let rejectedFeatureReleaseId: number;
let featureDtdAssignmentId: number;
let featureProductionAssignmentId: number;
let rejectedFeatureAssignmentId: number;

async function request(clerkUserId: string, path: string, init: RequestInit = {}) {
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

const releasePayload = (suffix: string) => ({
  appPayload: {
    artifactName: `construct-lifecycle-${suffix}`,
    artifactVersion: "2026.09.14",
    digest: `sha256:${suffix}-artifact`,
    sourceCommit: `commit-${suffix}`,
    buildId: `build-${suffix}`,
    entrypoint: "server/index.js",
  },
  configPayload: {
    configName: `construct-lifecycle-${suffix}`,
    configVersion: "2026.09.14",
    digest: `sha256:${suffix}-config`,
    schemaVersion: "1",
    sourceCommit: `commit-${suffix}`,
    buildId: `build-${suffix}`,
  },
});

async function createRelease(
  releaseType: "security" | "platform" | "feature",
  suffix: string,
  mandatory = false,
) {
  return request(clerkIds.platformAdmin, "/platform/releases", {
    method: "POST",
    body: JSON.stringify({
      releaseType,
      version: `2026.09.14-${suffix}-${runId}`,
      mandatory,
      ...releasePayload(suffix),
    }),
  });
}

before(async () => {
  const [tenantA, tenantB] = await db.insert(tenantsTable).values([
    { name: "Release Gate Tenant A", slug: `release-gates-a-${runId}` },
    { name: "Release Gate Tenant B", slug: `release-gates-b-${runId}` },
  ]).returning();
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  const [dtdA, productionA, dtdB] = await db.insert(environmentsTable).values([
    { tenantId: tenantAId, name: "Development / Test / Demo", slug: `dtd-${runId}`, kind: "dtd", status: "active" },
    { tenantId: tenantAId, name: "Production", slug: `production-${runId}`, kind: "production", status: "active" },
    { tenantId: tenantBId, name: "Development / Test / Demo", slug: `dtd-b-${runId}`, kind: "dtd", status: "active" },
  ]).returning();
  dtdAId = dtdA.id;
  productionAId = productionA.id;
  dtdBId = dtdB.id;

  const users = await db.insert(usersTable).values([
    { clerkUserId: clerkIds.platformAdmin, email: `${clerkIds.platformAdmin}@integration.test`, displayName: "Platform Admin", isPlatformAdmin: true },
    { clerkUserId: clerkIds.ownerA, email: `${clerkIds.ownerA}@integration.test`, displayName: "Customer Owner A" },
    { clerkUserId: clerkIds.memberA, email: `${clerkIds.memberA}@integration.test`, displayName: "Customer Member A" },
    { clerkUserId: clerkIds.ownerB, email: `${clerkIds.ownerB}@integration.test`, displayName: "Customer Owner B" },
  ]).returning();
  const userId = Object.fromEntries(users.map((user) => [user.clerkUserId, user.id]));
  platformAdminId = userId[clerkIds.platformAdmin];

  await db.insert(membershipsTable).values([
    { tenantId: tenantAId, userId: userId[clerkIds.ownerA], role: "owner", environmentAccessConfigured: true },
    { tenantId: tenantAId, userId: userId[clerkIds.memberA], role: "admin", environmentAccessConfigured: true },
    { tenantId: tenantBId, userId: userId[clerkIds.ownerB], role: "owner", environmentAccessConfigured: true },
  ]);
  await db.insert(tenantEnvironmentAccessTable).values([
    { tenantId: tenantAId, environmentId: dtdAId, userId: userId[clerkIds.ownerA], grantedByUserId: userId[clerkIds.ownerA] },
    { tenantId: tenantAId, environmentId: dtdAId, userId: userId[clerkIds.memberA], grantedByUserId: userId[clerkIds.ownerA] },
    { tenantId: tenantBId, environmentId: dtdBId, userId: userId[clerkIds.ownerB], grantedByUserId: userId[clerkIds.ownerB] },
  ]);
  await db.insert(userTenantContextTable).values([
    { userId: userId[clerkIds.platformAdmin], activeTenantId: tenantAId, activeEnvironmentId: dtdAId },
    { userId: userId[clerkIds.ownerA], activeTenantId: tenantAId, activeEnvironmentId: dtdAId },
    { userId: userId[clerkIds.memberA], activeTenantId: tenantAId, activeEnvironmentId: dtdAId },
    { userId: userId[clerkIds.ownerB], activeTenantId: tenantBId, activeEnvironmentId: dtdBId },
  ]);

  await db.insert(environmentResourcesTable).values(
    resourceTypes.map((resourceType) => ({
      tenantId: tenantAId,
      environmentId: productionAId,
      resourceType,
      status: "ready",
      providerKey: "release-gate-integration",
      secretReference: resourceType === "runtime" ? "runtime-signing-reference" : null,
      externalId: `${productionAId}-${resourceType}-${runId}`,
    })),
  );
  await db.insert(environmentHealthChecksTable).values({
    tenantId: tenantAId,
    environmentId: productionAId,
    status: "healthy",
    checks: { integration: "healthy" },
    checkedByUserId: platformAdminId,
    checkedAt: new Date(),
  });
  await db.insert(environmentSnapshotsTable).values({
    tenantId: tenantAId,
    environmentId: productionAId,
    idempotencyKey: `release-gate-backup-${runId}`,
    kind: "backup",
    status: "verified",
    sanitized: "not_applicable",
    backupReference: `backup-${runId}`,
    checksum: `checksum-${runId}`,
    verificationDetails: { verified: true },
    createdByUserId: platformAdminId,
    verifiedAt: new Date(),
  });

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
  if (tenantAId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantAId));
  if (tenantBId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantBId));
  await pool.end();
});

test("requires DTD deployment, validation, and customer approval before feature production promotion", async () => {
  const created = await createRelease("feature", "feature-main");
  assert.equal(created.status, 201, JSON.stringify(created.body));
  featureReleaseId = (created.body as { id: number }).id;

  const dtdAssignment = await request(
    clerkIds.platformAdmin,
    `/platform/releases/${featureReleaseId}/assign`,
    { method: "POST", body: JSON.stringify({ environmentId: dtdAId }) },
  );
  assert.equal(dtdAssignment.status, 201, JSON.stringify(dtdAssignment.body));
  featureDtdAssignmentId = (dtdAssignment.body as { id: number }).id;
  assert.equal((dtdAssignment.body as { approvalStatus: string }).approvalStatus, "pending");
  assert.equal((dtdAssignment.body as { validationStatus: string }).validationStatus, "pending");

  const platformApproval = await request(
    clerkIds.platformAdmin,
    `/tenant/releases/${featureDtdAssignmentId}/approve`,
    { method: "POST" },
  );
  assert.equal(platformApproval.status, 403);

  const approvalBeforeValidation = await request(
    clerkIds.ownerA,
    `/tenant/releases/${featureDtdAssignmentId}/approve`,
    { method: "POST" },
  );
  assert.equal(approvalBeforeValidation.status, 409);

  const productionBeforeApproval = await request(
    clerkIds.platformAdmin,
    `/platform/releases/${featureReleaseId}/assign`,
    { method: "POST", body: JSON.stringify({ environmentId: productionAId }) },
  );
  assert.equal(productionBeforeApproval.status, 409);

  const dtdDeployment = await request(
    clerkIds.platformAdmin,
    `/platform/releases/${featureReleaseId}/deploy`,
    { method: "POST", body: JSON.stringify({ environmentId: dtdAId }) },
  );
  assert.equal(dtdDeployment.status, 200, JSON.stringify(dtdDeployment.body));
  assert.equal((dtdDeployment.body as { deploymentStatus: string }).deploymentStatus, "deployed");

  const validation = await request(
    clerkIds.ownerA,
    `/tenant/releases/${featureDtdAssignmentId}/validate`,
    { method: "POST" },
  );
  assert.equal(validation.status, 200, JSON.stringify(validation.body));
  assert.equal((validation.body as { validationStatus: string }).validationStatus, "validated");

  const approval = await request(
    clerkIds.ownerA,
    `/tenant/releases/${featureDtdAssignmentId}/approve`,
    { method: "POST" },
  );
  assert.equal(approval.status, 200, JSON.stringify(approval.body));
  assert.equal((approval.body as { approvalStatus: string }).approvalStatus, "approved");
  assert.equal((approval.body as { approvedByUserId: number }).approvedByUserId > 0, true);

  const productionAssignment = await request(
    clerkIds.platformAdmin,
    `/platform/releases/${featureReleaseId}/assign`,
    { method: "POST", body: JSON.stringify({ environmentId: productionAId }) },
  );
  assert.equal(productionAssignment.status, 201, JSON.stringify(productionAssignment.body));
  featureProductionAssignmentId = (productionAssignment.body as { id: number }).id;
  assert.equal((productionAssignment.body as { sourceDtdAssignmentId: number }).sourceDtdAssignmentId, featureDtdAssignmentId);
  assert.equal((productionAssignment.body as { approvalStatus: string }).approvalStatus, "approved");
  assert.equal((productionAssignment.body as { validationStatus: string }).validationStatus, "validated");

  const productionDeployment = await request(
    clerkIds.platformAdmin,
    `/platform/releases/${featureReleaseId}/deploy`,
    { method: "POST", body: JSON.stringify({ environmentId: productionAId }) },
  );
  assert.equal(productionDeployment.status, 200, JSON.stringify(productionDeployment.body));
  assert.equal((productionDeployment.body as { deploymentStatus: string }).deploymentStatus, "deployed");
  const productionEvents = (productionDeployment.body as {
    events: Array<{ action: string; actorUserId: number | null; actorDisplayName: string }>;
  }).events;
  assert.equal(productionEvents.some((event) =>
    event.action === "deployed"
      && event.actorUserId !== null
      && event.actorDisplayName === clerkIds.platformAdmin,
  ), true);

  const [control] = await db.select().from(environmentReleaseControlsTable).where(eq(
    environmentReleaseControlsTable.assignmentId,
    featureProductionAssignmentId,
  ));
  assert.equal(control?.rollbackStatus, "available");

  await db.insert(releaseAssignmentEventsTable).values({
    releaseId: featureReleaseId,
    assignmentId: featureProductionAssignmentId,
    actorUserId: null,
    action: "legacy_transition",
    fromStatus: null,
    toStatus: null,
    details: JSON.stringify({ source: "legacy-audit-row" }),
  });
  const platformReleases = await request(clerkIds.platformAdmin, "/platform/releases");
  assert.equal(platformReleases.status, 200);
  const listedRelease = (platformReleases.body as Array<{
    id: number;
    assignments: Array<{ id: number; events: Array<{ action: string; actorDisplayName: string; actorUserId: number | null }> }>;
  }>).find((release) => release.id === featureReleaseId);
  const legacyEvent = listedRelease?.assignments
    .flatMap((assignment) => assignment.events)
    .find((event) => event.action === "legacy_transition");
  assert.deepEqual(
    { actorUserId: legacyEvent?.actorUserId, actorDisplayName: legacyEvent?.actorDisplayName },
    { actorUserId: null, actorDisplayName: "Legacy actor" },
  );
});

test("allows customer rejection only after DTD validation and records the rejection", async () => {
  const created = await createRelease("feature", "feature-rejected");
  assert.equal(created.status, 201, JSON.stringify(created.body));
  rejectedFeatureReleaseId = (created.body as { id: number }).id;

  const assigned = await request(
    clerkIds.platformAdmin,
    `/platform/releases/${rejectedFeatureReleaseId}/assign`,
    { method: "POST", body: JSON.stringify({ environmentId: dtdAId }) },
  );
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
  rejectedFeatureAssignmentId = (assigned.body as { id: number }).id;

  const deployed = await request(
    clerkIds.platformAdmin,
    `/platform/releases/${rejectedFeatureReleaseId}/deploy`,
    { method: "POST", body: JSON.stringify({ environmentId: dtdAId }) },
  );
  assert.equal(deployed.status, 200);

  const validated = await request(
    clerkIds.ownerA,
    `/tenant/releases/${rejectedFeatureAssignmentId}/validate`,
    { method: "POST" },
  );
  assert.equal(validated.status, 200);

  const rejected = await request(
    clerkIds.ownerA,
    `/tenant/releases/${rejectedFeatureAssignmentId}/reject`,
    { method: "POST", body: JSON.stringify({ reason: "Customer validation found a release-blocking issue." }) },
  );
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal((rejected.body as { approvalStatus: string }).approvalStatus, "rejected");
  assert.equal((rejected.body as { rejectionReason: string }).rejectionReason, "Customer validation found a release-blocking issue.");

  const productionAssignment = await request(
    clerkIds.platformAdmin,
    `/platform/releases/${rejectedFeatureReleaseId}/assign`,
    { method: "POST", body: JSON.stringify({ environmentId: productionAId }) },
  );
  assert.equal(productionAssignment.status, 409);
});

test("enforces direct-release, legacy-payload, tenant, and environment boundaries", async () => {
  const nonMandatoryPlatform = await createRelease("platform", "platform-not-mandatory");
  assert.equal(nonMandatoryPlatform.status, 201);
  const nonMandatoryPlatformId = (nonMandatoryPlatform.body as { id: number }).id;
  const directProductionRejected = await request(
    clerkIds.platformAdmin,
    `/platform/releases/${nonMandatoryPlatformId}/assign`,
    { method: "POST", body: JSON.stringify({ environmentId: productionAId }) },
  );
  assert.equal(directProductionRejected.status, 409);

  for (const releaseType of ["platform", "security"] as const) {
    const mandatory = await createRelease(releaseType, `mandatory-${releaseType}`, true);
    assert.equal(mandatory.status, 201, JSON.stringify(mandatory.body));
    const mandatoryId = (mandatory.body as { id: number }).id;
    const assigned = await request(
      clerkIds.platformAdmin,
      `/platform/releases/${mandatoryId}/assign`,
      { method: "POST", body: JSON.stringify({ environmentId: productionAId }) },
    );
    assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
    const deployed = await request(
      clerkIds.platformAdmin,
      `/platform/releases/${mandatoryId}/deploy`,
      { method: "POST", body: JSON.stringify({ environmentId: productionAId }) },
    );
    assert.equal(deployed.status, 200, JSON.stringify(deployed.body));
    assert.equal((deployed.body as { deploymentStatus: string }).deploymentStatus, "deployed");
  }

  const [legacy] = await db.insert(platformReleasesTable).values({
    releaseType: "feature",
    status: "released",
    version: `legacy-${runId}`,
    appPayload: JSON.stringify({ artifactName: "legacy-without-digest" }),
    configPayload: JSON.stringify({ configName: "legacy-without-digest" }),
    mandatory: false,
    createdByUserId: platformAdminId,
  }).returning();
  const legacyAssignment = await request(
    clerkIds.platformAdmin,
    `/platform/releases/${legacy.id}/assign`,
    { method: "POST", body: JSON.stringify({ environmentId: dtdAId }) },
  );
  assert.equal(legacyAssignment.status, 409);
  const legacyDeployment = await request(
    clerkIds.platformAdmin,
    `/platform/releases/${legacy.id}/deploy`,
    { method: "POST", body: JSON.stringify({ environmentId: dtdAId }) },
  );
  assert.equal(legacyDeployment.status, 409);

  const memberView = await request(clerkIds.memberA, "/tenant/releases");
  assert.equal(memberView.status, 200, JSON.stringify(memberView.body));
  const memberAssignments = memberView.body as Array<{
    environmentId: number;
    id: number;
    events: Array<{ actorDisplayName: string; actorUserId: number | null }>;
  }>;
  assert.equal(memberAssignments.some((assignment) => assignment.id === featureDtdAssignmentId), true);
  assert.equal(memberAssignments.some((assignment) => assignment.environmentId === productionAId), false);
  assert.equal(memberAssignments.some((assignment) => assignment.environmentId === dtdBId), false);
  assert.equal(memberAssignments
    .find((assignment) => assignment.id === featureDtdAssignmentId)
    ?.events.some((event) => event.actorDisplayName === clerkIds.platformAdmin && event.actorUserId !== null), true);

  const unauthorizedEnvironmentChange = await request(
    clerkIds.memberA,
    `/tenant/releases/${featureProductionAssignmentId}/approve`,
    { method: "POST" },
  );
  assert.equal(unauthorizedEnvironmentChange.status, 404);

  const crossTenantView = await request(clerkIds.ownerB, "/tenant/releases");
  assert.equal(crossTenantView.status, 200);
  assert.deepEqual(crossTenantView.body, []);
  const crossTenantChange = await request(
    clerkIds.ownerB,
    `/tenant/releases/${featureDtdAssignmentId}/approve`,
    { method: "POST" },
  );
  assert.equal(crossTenantChange.status, 404);

  const assignmentsInDatabase = await db.select().from(environmentReleaseAssignmentsTable).where(and(
    eq(environmentReleaseAssignmentsTable.releaseId, featureReleaseId),
    eq(environmentReleaseAssignmentsTable.environmentId, productionAId),
  ));
  assert.equal(assignmentsInDatabase.length, 1);
});