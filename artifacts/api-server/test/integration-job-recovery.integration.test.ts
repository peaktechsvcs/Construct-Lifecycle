import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";

process.env.APP_ENV = "test";

const {
  db,
  environmentsTable,
  integrationAuditEventsTable,
  integrationEntitlementsTable,
  integrationJobsTable,
  membershipsTable,
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
  owner: `integration-job-owner-${runId}`,
  otherTenantOwner: `integration-job-other-owner-${runId}`,
};

let server: Server;
let baseUrl = "";
let tenantId: number;
let otherTenantId: number;
let environmentId: number;
let otherEnvironmentId: number;
let ownerId: number;
let retryJobId: number;
let deadLetterJobId: number;

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
  const [tenant, otherTenant] = await db.insert(tenantsTable).values([
    { name: `Integration Job Tenant ${runId}`, slug: `integration-job-${runId}` },
    { name: `Integration Job Other Tenant ${runId}`, slug: `integration-job-other-${runId}` },
  ]).returning();
  tenantId = tenant.id;
  otherTenantId = otherTenant.id;

  const [environment, otherEnvironment] = await db.insert(environmentsTable).values([
    { tenantId, name: "Development / Test / Demo", slug: `integration-job-dtd-${runId}`, kind: "dtd", status: "active" },
    { tenantId: otherTenantId, name: "Development / Test / Demo", slug: `integration-job-other-dtd-${runId}`, kind: "dtd", status: "active" },
  ]).returning();
  environmentId = environment.id;
  otherEnvironmentId = otherEnvironment.id;

  const [owner, otherTenantOwner] = await db.insert(usersTable).values([
    { clerkUserId: clerkIds.owner, email: `${clerkIds.owner}@integration.test`, displayName: "Integration Job Owner" },
    { clerkUserId: clerkIds.otherTenantOwner, email: `${clerkIds.otherTenantOwner}@integration.test`, displayName: "Other Tenant Owner" },
  ]).returning();
  ownerId = owner.id;

  await db.insert(membershipsTable).values([
    { tenantId, userId: owner.id, role: "owner", environmentAccessConfigured: true },
    { tenantId: otherTenantId, userId: otherTenantOwner.id, role: "owner", environmentAccessConfigured: true },
  ]);
  await db.insert(tenantEnvironmentAccessTable).values([
    { tenantId, environmentId, userId: owner.id, grantedByUserId: owner.id },
    { tenantId: otherTenantId, environmentId: otherEnvironmentId, userId: otherTenantOwner.id, grantedByUserId: otherTenantOwner.id },
  ]);
  await db.insert(userTenantContextTable).values([
    { userId: owner.id, activeTenantId: tenantId, activeEnvironmentId: environmentId },
    { userId: otherTenantOwner.id, activeTenantId: otherTenantId, activeEnvironmentId: otherEnvironmentId },
  ]);
  await db.insert(integrationEntitlementsTable).values({
    tenantId,
    capabilityKey: "google_workspace",
    enabled: true,
  });

  const [retryJob, deadLetterJob] = await db.insert(integrationJobsTable).values([
    {
      tenantId,
      environmentId,
      providerKey: "google_workspace",
      jobType: "mailbox_sync",
      status: "retry",
      attempts: 2,
      maxAttempts: 3,
      nextRetryAt: new Date(Date.now() - 60_000),
      lastError: "Provider timeout",
    },
    {
      tenantId,
      environmentId,
      providerKey: "google_workspace",
      jobType: "drive_sync",
      status: "dead_letter",
      attempts: 3,
      maxAttempts: 3,
      deadLetteredAt: new Date(Date.now() - 30_000),
      lastError: "Missing permission",
    },
  ]).returning();
  retryJobId = retryJob.id;
  deadLetterJobId = deadLetterJob.id;

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
  if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (otherTenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, otherTenantId));
  await db.delete(usersTable).where(inArray(usersTable.clerkUserId, Object.values(clerkIds)));
  await pool.end();
});

test("retries eligible jobs once, marks dead letters reviewed, audits both actions, and stays tenant scoped", async () => {
  const retry = await request(clerkIds.owner, `/integrations/jobs/${retryJobId}/retry`, { method: "POST" });
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal((retry.body as { status: string }).status, "queued");
  assert.equal((retry.body as { attempts: number }).attempts, 0);

  const duplicateRetry = await request(clerkIds.owner, `/integrations/jobs/${retryJobId}/retry`, { method: "POST" });
  assert.equal(duplicateRetry.status, 409);

  const review = await request(clerkIds.owner, `/integrations/jobs/${deadLetterJobId}/review`, { method: "POST" });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  assert.equal((review.body as { status: string }).status, "reviewed");
  assert.equal((review.body as { deadLetteredAt: string | null }).deadLetteredAt !== null, true);

  const duplicateReview = await request(clerkIds.owner, `/integrations/jobs/${deadLetterJobId}/review`, { method: "POST" });
  assert.equal(duplicateReview.status, 409);

  const otherTenantAttempt = await request(
    clerkIds.otherTenantOwner,
    `/integrations/jobs/${retryJobId}/retry`,
    { method: "POST" },
  );
  assert.equal(otherTenantAttempt.status, 404);

  const audit = await db.select({
    action: integrationAuditEventsTable.action,
    actorUserId: integrationAuditEventsTable.actorUserId,
    details: integrationAuditEventsTable.details,
  }).from(integrationAuditEventsTable).where(eq(integrationAuditEventsTable.tenantId, tenantId));
  assert.equal(audit.filter((event) => event.action === "job_retry_requested").length, 1);
  assert.equal(audit.filter((event) => event.action === "job_reviewed").length, 1);
  assert.equal(audit.every((event) => event.actorUserId === ownerId), true);
});

test("rate limits manual retry requests and returns a retry hint", async () => {
  const jobs = await db.insert(integrationJobsTable).values(
    Array.from({ length: 4 }, (_, index) => ({
      tenantId,
      environmentId,
      providerKey: "google_workspace",
      jobType: `mailbox_retry_${index}`,
      status: "dead_letter",
      attempts: 3,
      maxAttempts: 3,
      deadLetteredAt: new Date(),
    })),
  ).returning();

  const responses = [];
  for (const job of jobs) {
    responses.push(await request(clerkIds.owner, `/integrations/jobs/${job.id}/retry`, { method: "POST" }));
  }
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 429, 429]);
  assert.equal(typeof responses[2]?.body, "object");
});