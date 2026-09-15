import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";

process.env.APP_ENV = "test";
process.env.REPLIT_CONNECTORS_HOSTNAME = "integrations-billing-unavailable.test";

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === process.env.REPLIT_CONNECTORS_HOSTNAME) {
    return new Response(JSON.stringify({ error: "connector unavailable for test" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  return nativeFetch(input, init);
};

const {
  db,
  environmentsTable,
  integrationJobsTable,
  integrationEntitlementsTable,
  integrationsTable,
  membershipsTable,
  pool,
  tenantBillingAccountsTable,
  tenantEnvironmentAccessTable,
  tenantEntitlementOverridesTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const { default: app } = await import("../src/app.ts");

type Json = Record<string, unknown> | unknown[];
type IntegrationResponse = {
  providerKey: string;
  state: "cataloged" | "connected" | "degraded";
  connection: {
    status: string;
    healthStatus: string;
    lastError: string | null;
    retryCount: number;
    deadLetterCount: number;
    lastSuccessfulSyncAt: string | null;
    [key: string]: unknown;
  } | null;
};
type JobResponse = {
  id: number;
  providerKey: string;
  jobType: string;
  status: string;
  lastError: string | null;
};

const runId = `${Date.now()}-${process.pid}`;
const clerkIds = {
  ownerA: `integrations-owner-a-${runId}`,
  viewerA: `integrations-viewer-a-${runId}`,
  ownerB: `integrations-owner-b-${runId}`,
};

let server: Server;
let baseUrl = "";
let tenantAId: number;
let tenantBId: number;
let environmentAProductionId: number;
let environmentADevelopmentId: number;
let environmentBProductionId: number;
let ownerAId: number;
let viewerAId: number;
let ownerBId: number;
let googleIntegrationId: number;
let quickBooksIntegrationId: number;

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

before(async () => {
  const [tenantA, tenantB] = await db.insert(tenantsTable).values([
    { name: `Integrations Tenant A ${runId}`, slug: `integrations-a-${runId}` },
    { name: `Integrations Tenant B ${runId}`, slug: `integrations-b-${runId}` },
  ]).returning();
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  const [environmentAProduction, environmentADevelopment, environmentBProduction] = await db.insert(environmentsTable).values([
    {
      tenantId: tenantAId,
      name: "Production",
      slug: `integrations-production-${runId}`,
      kind: "production",
      status: "active",
    },
    {
      tenantId: tenantAId,
      name: "Development / Test / Demo",
      slug: `integrations-dtd-${runId}`,
      kind: "dtd",
      status: "active",
    },
    {
      tenantId: tenantBId,
      name: "Production",
      slug: `integrations-other-production-${runId}`,
      kind: "production",
      status: "active",
    },
  ]).returning();
  environmentAProductionId = environmentAProduction.id;
  environmentADevelopmentId = environmentADevelopment.id;
  environmentBProductionId = environmentBProduction.id;

  const [ownerA, viewerA, ownerB] = await db.insert(usersTable).values([
    { clerkUserId: clerkIds.ownerA, email: `${clerkIds.ownerA}@integration.test`, displayName: "Integration Owner A" },
    { clerkUserId: clerkIds.viewerA, email: `${clerkIds.viewerA}@integration.test`, displayName: "Integration Viewer A" },
    { clerkUserId: clerkIds.ownerB, email: `${clerkIds.ownerB}@integration.test`, displayName: "Integration Owner B" },
  ]).returning();
  ownerAId = ownerA.id;
  viewerAId = viewerA.id;
  ownerBId = ownerB.id;

  await db.insert(membershipsTable).values([
    { tenantId: tenantAId, userId: ownerAId, role: "owner", environmentAccessConfigured: true },
    { tenantId: tenantAId, userId: viewerAId, role: "viewer", environmentAccessConfigured: true },
    { tenantId: tenantBId, userId: ownerBId, role: "owner", environmentAccessConfigured: true },
  ]);
  await db.insert(tenantEnvironmentAccessTable).values([
    { tenantId: tenantAId, environmentId: environmentAProductionId, userId: ownerAId, grantedByUserId: ownerAId },
    { tenantId: tenantAId, environmentId: environmentADevelopmentId, userId: ownerAId, grantedByUserId: ownerAId },
    { tenantId: tenantAId, environmentId: environmentAProductionId, userId: viewerAId, grantedByUserId: ownerAId },
    { tenantId: tenantBId, environmentId: environmentBProductionId, userId: ownerBId, grantedByUserId: ownerBId },
  ]);
  await db.insert(userTenantContextTable).values([
    { userId: ownerAId, activeTenantId: tenantAId, activeEnvironmentId: environmentAProductionId },
    { userId: viewerAId, activeTenantId: tenantAId, activeEnvironmentId: environmentAProductionId },
    { userId: ownerBId, activeTenantId: tenantBId, activeEnvironmentId: environmentBProductionId },
  ]);

  await db.insert(integrationEntitlementsTable).values([
    { tenantId: tenantAId, capabilityKey: "google_workspace", enabled: true },
    { tenantId: tenantAId, capabilityKey: "docusign", enabled: true },
    { tenantId: tenantAId, capabilityKey: "quickbooks", enabled: true },
  ]);

  const now = new Date();
  const [googleIntegration, quickBooksIntegration] = await db.insert(integrationsTable).values([
    {
      tenantId: tenantAId,
      environmentId: environmentAProductionId,
      providerKey: "google_workspace",
      providerCategory: "productivity_collaboration",
      status: "connected",
      connectionType: "replit_managed_oauth",
      configuration: JSON.stringify({ connectorName: "google-mail" }),
      credentialsReference: `replit-connector:google-mail:${runId}`,
      lastSyncAt: now,
      lastSuccessfulSyncAt: now,
      lastSyncStatus: "success",
    },
    {
      tenantId: tenantAId,
      environmentId: environmentAProductionId,
      providerKey: "quickbooks",
      providerCategory: "accounting",
      status: "warning",
      connectionType: "replit_managed_oauth",
      configuration: JSON.stringify({ connectorName: "quickbooks" }),
      credentialsReference: `replit-connector:quickbooks:${runId}`,
      lastSyncAt: now,
      lastSuccessfulSyncAt: new Date(now.getTime() - 3_600_000),
      lastSyncStatus: "retry",
      lastFailureAt: now,
      lastError: "Provider timeout",
    },
  ]).returning();
  googleIntegrationId = googleIntegration.id;
  quickBooksIntegrationId = quickBooksIntegration.id;

  await db.insert(integrationJobsTable).values([
    {
      tenantId: tenantAId,
      environmentId: environmentAProductionId,
      integrationId: googleIntegrationId,
      providerKey: "google_workspace",
      jobType: "mailbox_preview",
      status: "succeeded",
      attempts: 1,
      maxAttempts: 3,
      completedAt: now,
    },
    {
      tenantId: tenantAId,
      environmentId: environmentAProductionId,
      integrationId: quickBooksIntegrationId,
      providerKey: "quickbooks",
      jobType: "project_accounting_sync",
      status: "retry",
      attempts: 1,
      maxAttempts: 3,
      nextRetryAt: new Date(now.getTime() + 60_000),
      lastError: "Provider timeout",
    },
    {
      tenantId: tenantAId,
      environmentId: environmentAProductionId,
      integrationId: quickBooksIntegrationId,
      providerKey: "quickbooks",
      jobType: "project_accounting_sync",
      status: "dead_letter",
      attempts: 3,
      maxAttempts: 3,
      deadLetteredAt: now,
      lastError: "Missing permission",
    },
    {
      tenantId: tenantAId,
      environmentId: environmentADevelopmentId,
      integrationId: googleIntegrationId,
      providerKey: "google_workspace",
      jobType: "dtd_mailbox_sync",
      status: "dead_letter",
      attempts: 3,
      maxAttempts: 3,
      deadLetteredAt: now,
      lastError: "Other environment job",
    },
    {
      tenantId: tenantBId,
      environmentId: environmentBProductionId,
      providerKey: "google_workspace",
      jobType: "other_tenant_sync",
      status: "retry",
      attempts: 1,
      maxAttempts: 3,
      nextRetryAt: now,
      lastError: "Other tenant job",
    },
    {
      tenantId: tenantAId,
      environmentId: environmentAProductionId,
      providerKey: "docusign",
      jobType: "other_provider_sync",
      status: "retry",
      attempts: 1,
      maxAttempts: 3,
      nextRetryAt: now,
      lastError: "Other provider job",
    },
  ]);

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
  await db.delete(usersTable).where(inArray(usersTable.id, [ownerAId, viewerAId, ownerBId]));
  await pool.end();
});

test("lists cataloged, connected, and degraded health without credential material", async () => {
  const response = await request(clerkIds.ownerA, "/integrations");
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const integrations = response.body as IntegrationResponse[];

  const cataloged = integrations.find((item) => item.providerKey === "docusign");
  assert.equal(cataloged?.state, "cataloged");
  assert.equal(cataloged?.connection, null);

  const connected = integrations.find((item) => item.providerKey === "google_workspace");
  assert.equal(connected?.state, "connected");
  assert.equal(connected?.connection?.healthStatus, "healthy");
  assert.equal(connected?.connection?.lastSuccessfulSyncAt !== null, true);

  const degraded = integrations.find((item) => item.providerKey === "quickbooks");
  assert.equal(degraded?.state, "degraded");
  assert.equal(degraded?.connection?.status, "warning");
  assert.equal(degraded?.connection?.healthStatus, "failed");
  assert.equal(degraded?.connection?.retryCount, 1);
  assert.equal(degraded?.connection?.deadLetterCount, 1);
  assert.equal(degraded?.connection?.lastError, "Provider timeout");
  assert.equal(JSON.stringify(response.body).includes("credentialsReference"), false);
  assert.equal(JSON.stringify(response.body).includes("replit-connector:"), false);
});

test("lists only active tenant/environment jobs and honors provider and limit filters", async () => {
  const response = await request(clerkIds.ownerA, "/integrations/jobs?providerKey=google_workspace&limit=1");
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const jobs = response.body as JobResponse[];
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.providerKey, "google_workspace");
  assert.equal(jobs[0]?.jobType, "mailbox_preview");
  assert.equal(jobs.some((job) => job.jobType === "dtd_mailbox_sync"), false);
  assert.equal(jobs.some((job) => job.jobType === "other_tenant_sync"), false);
  assert.equal(jobs.some((job) => job.jobType === "other_provider_sync"), false);
  assert.equal(JSON.stringify(jobs).includes("Other environment job"), false);
  assert.equal(JSON.stringify(jobs).includes("Other tenant job"), false);

  const quickBooks = await request(clerkIds.ownerA, "/integrations/jobs?providerKey=quickbooks&limit=10");
  assert.equal(quickBooks.status, 200, JSON.stringify(quickBooks.body));
  assert.deepEqual((quickBooks.body as JobResponse[]).map((job) => job.status).sort(), ["dead_letter", "retry"]);
});

test("denies viewers and users without an active entitlement from health and job routes", async () => {
  const viewerList = await request(clerkIds.viewerA, "/integrations");
  assert.equal(viewerList.status, 403);

  const viewerJobs = await request(clerkIds.viewerA, "/integrations/jobs?providerKey=google_workspace");
  assert.equal(viewerJobs.status, 403);

  const unentitledList = await request(clerkIds.ownerB, "/integrations");
  assert.equal(unentitledList.status, 200);
  assert.deepEqual(unentitledList.body, []);

  const unentitledJobs = await request(clerkIds.ownerB, "/integrations/jobs?providerKey=google_workspace");
  assert.equal(unentitledJobs.status, 404);
  assert.deepEqual(unentitledJobs.body, { error: "Integration provider not available" });
});

test("returns stable errors for unknown providers and malformed job limits", async () => {
  const missingProvider = await request(clerkIds.ownerA, "/integrations/jobs?providerKey=missing_provider");
  assert.equal(missingProvider.status, 404);
  assert.deepEqual(missingProvider.body, { error: "Integration provider not found" });

  const malformedLimit = await request(clerkIds.ownerA, "/integrations/jobs?providerKey=google_workspace&limit=0");
  assert.equal(malformedLimit.status, 404);
  assert.deepEqual(malformedLimit.body, { error: "Integration provider not found" });

  const oversizedLimit = await request(clerkIds.ownerA, "/integrations/jobs?providerKey=google_workspace&limit=101");
  assert.equal(oversizedLimit.status, 404);
  assert.deepEqual(oversizedLimit.body, { error: "Integration provider not found" });
});

test("blocks suspended paid integrations while preserving tenant-scoped support grants", async () => {
  await db.insert(tenantBillingAccountsTable).values({
    tenantId: tenantBId,
    externalCustomerId: `missing-customer-${runId}`,
  });
  await db.insert(integrationEntitlementsTable).values({
    tenantId: tenantBId,
    capabilityKey: "google_workspace",
    enabled: true,
  });

  const suspendedList = await request(clerkIds.ownerB, "/integrations");
  assert.equal(suspendedList.status, 200, JSON.stringify(suspendedList.body));
  assert.deepEqual(suspendedList.body, []);

  const suspendedJobs = await request(clerkIds.ownerB, "/integrations/jobs?providerKey=google_workspace");
  assert.equal(suspendedJobs.status, 404);
  assert.deepEqual(suspendedJobs.body, { error: "Integration provider not available" });

  const suspendedConnect = await request(clerkIds.ownerB, "/integrations/google_workspace/connect", { method: "POST" });
  assert.equal(suspendedConnect.status, 404);
  assert.deepEqual(suspendedConnect.body, { error: "Integration provider not available" });

  await db.insert(tenantEntitlementOverridesTable).values({
    tenantId: tenantBId,
    capabilityKey: "google_workspace",
    enabled: true,
  });

  const grantedList = await request(clerkIds.ownerB, "/integrations");
  assert.equal(grantedList.status, 200, JSON.stringify(grantedList.body));
  assert.equal((grantedList.body as IntegrationResponse[]).some((item) => item.providerKey === "google_workspace"), true);

  const tenantAList = await request(clerkIds.ownerA, "/integrations");
  assert.equal(tenantAList.status, 200, JSON.stringify(tenantAList.body));
  assert.equal((tenantAList.body as IntegrationResponse[]).some((item) => item.providerKey === "google_workspace"), true);

  await db.insert(tenantEntitlementOverridesTable).values({
    tenantId: tenantBId,
    capabilityKey: "google_workspace",
    enabled: false,
  }).onConflictDoUpdate({
    target: [tenantEntitlementOverridesTable.tenantId, tenantEntitlementOverridesTable.capabilityKey],
    set: { enabled: false, updatedAt: new Date() },
  });

  const deniedList = await request(clerkIds.ownerB, "/integrations");
  assert.equal(deniedList.status, 200, JSON.stringify(deniedList.body));
  assert.deepEqual(deniedList.body, []);
});
