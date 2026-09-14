import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  markIntegrationJobFailed,
  startIntegrationJob,
} from "../src/lib/integrations/job-lifecycle.ts";

process.env.APP_ENV = "test";

let connectorMode: "success" | "failure" = "success";

const base64Url = (value: string) => Buffer.from(value, "utf8").toString("base64url");

ReplitConnectors.prototype.proxy = async function (_provider, path) {
  if (connectorMode === "failure") {
    return {
      ok: false,
      status: 503,
      json: async () => ({}),
    };
  }
  if (path.includes("threads:search")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        threads: [{
          id: "thread-1",
          messages: [{
            id: "message-1",
            subject: "ITB North Campus",
            sender: "bids@example.com",
            date: "2026-09-14T10:00:00Z",
            snippet: "Please bid on the North Campus work.",
          }],
        }],
        nextPageToken: null,
      }),
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      messages: [{
        id: "message-1",
        snippet: "Project: North Campus\nBid due: September 30, 2026",
        date: "2026-09-14T10:00:00Z",
        payload: {
          headers: [
            { name: "From", value: "bids@example.com" },
            { name: "Subject", value: "ITB North Campus" },
          ],
          mimeType: "text/plain",
          body: { data: base64Url("Project: North Campus\nBid due: September 30, 2026") },
        },
      }],
    }),
  };
};

const {
  db,
  environmentsTable,
  integrationAuditEventsTable,
  integrationEntitlementsTable,
  integrationJobsTable,
  integrationsTable,
  membershipsTable,
  platformAuditEventsTable,
  pool,
  tenantEnvironmentAccessTable,
  tenantsTable,
  itbIntakesTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const { default: app } = await import("../src/app.ts");

type Json = Record<string, unknown> | unknown[];

const runId = `${Date.now()}-${process.pid}`;
const clerkUserId = `integration-work-owner-${runId}`;
let server: Server;
let baseUrl = "";
let tenantId: number;
let environmentId: number;
let userId: number;
let integrationId: number;

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

const scope = () => ({
  tenantId,
  environmentId,
  integrationId,
  providerKey: "google_workspace",
});

before(async () => {
  const [tenant] = await db.insert(tenantsTable).values({
    name: `Integration Work Tenant ${runId}`,
    slug: `integration-work-${runId}`,
  }).returning();
  tenantId = tenant.id;

  const [environment] = await db.insert(environmentsTable).values({
    tenantId,
    name: "Development / Test / Demo",
    slug: `dtd-${runId}`,
    kind: "dtd",
    status: "active",
  }).returning();
  environmentId = environment.id;

  const [user] = await db.insert(usersTable).values({
    clerkUserId,
    email: `${clerkUserId}@integration.test`,
    displayName: "Integration Work Owner",
  }).returning();
  userId = user.id;

  await db.insert(membershipsTable).values({
    tenantId,
    userId,
    role: "owner",
    environmentAccessConfigured: true,
  });
  await db.insert(tenantEnvironmentAccessTable).values({
    tenantId,
    environmentId,
    userId,
    grantedByUserId: userId,
  });
  await db.insert(userTenantContextTable).values({
    userId,
    activeTenantId: tenantId,
    activeEnvironmentId: environmentId,
  });
  await db.insert(integrationEntitlementsTable).values({
    tenantId,
    capabilityKey: "google_workspace",
    enabled: true,
  });
  const [integration] = await db.insert(integrationsTable).values({
    tenantId,
    environmentId,
    providerKey: "google_workspace",
    providerCategory: "productivity_collaboration",
    status: "connected",
    connectionType: "replit_managed_oauth",
    configuration: JSON.stringify({ connectorName: "google-mail" }),
    credentialsReference: `replit-connector:google-mail:test-${runId}`,
  }).returning();
  integrationId = integration.id;

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
  if (tenantId) await db.delete(platformAuditEventsTable).where(eq(platformAuditEventsTable.tenantId, tenantId));
  if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await pool.end();
});

test("records scoped mailbox preview and import work and updates successful health", async () => {
  connectorMode = "success";
  const preview = await request("/itb-intakes/mailbox/preview?provider=google-mail&q=newer_than%3A30d%20bid");
  assert.equal(preview.status, 200, JSON.stringify(preview.body));

  const imported = await request("/itb-intakes/mailbox/import", {
    method: "POST",
    body: JSON.stringify({ provider: "google-mail", threadId: "thread-1", messageId: "message-1" }),
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));

  const jobs = await db.select().from(integrationJobsTable)
    .where(and(
      eq(integrationJobsTable.tenantId, tenantId),
      eq(integrationJobsTable.environmentId, environmentId),
      eq(integrationJobsTable.providerKey, "google_workspace"),
    ))
    .orderBy(integrationJobsTable.createdAt);
  assert.deepEqual(jobs.map((job) => [job.jobType, job.status, job.attempts]), [
    ["mailbox_preview", "succeeded", 1],
    ["mailbox_import", "succeeded", 1],
  ]);
  assert.equal(jobs.every((job) => job.integrationId === integrationId), true);

  const [integration] = await db.select().from(integrationsTable).where(eq(integrationsTable.id, integrationId));
  assert.equal(integration?.status, "connected");
  assert.equal(integration?.lastSyncStatus, "success");
  assert.equal(integration?.lastSyncAt instanceof Date, true);
  assert.equal(integration?.lastSuccessfulSyncAt instanceof Date, true);
  assert.equal(integration?.lastError, null);

  const [intake] = await db.select().from(itbIntakesTable).where(and(
    eq(itbIntakesTable.tenantId, tenantId),
    eq(itbIntakesTable.environmentId, environmentId),
    eq(itbIntakesTable.sourceMessageId, "message-1"),
  ));
  assert.equal(intake?.sourceProvider, "google-mail");
  assert.equal(intake?.sourceType, "gmail");
  assert.equal(intake?.sourceSubject, "ITB North Campus");
});

test("records mailbox failures for retry and keeps connector errors bounded", async () => {
  connectorMode = "failure";
  const failed = await request("/itb-intakes/mailbox/preview?provider=google-mail&q=failure");
  assert.equal(failed.status, 424);

  const [job] = await db.select().from(integrationJobsTable)
    .where(and(
      eq(integrationJobsTable.tenantId, tenantId),
      eq(integrationJobsTable.environmentId, environmentId),
      eq(integrationJobsTable.jobType, "mailbox_preview"),
    ))
    .orderBy(desc(integrationJobsTable.createdAt))
    .limit(1);
  assert.equal(job?.status, "retry");
  assert.equal(job?.attempts, 1);
  assert.equal(job?.nextRetryAt instanceof Date, true);
  assert.equal(job?.lastError, "google-mail mailbox connector returned 503");

  const [integration] = await db.select().from(integrationsTable).where(eq(integrationsTable.id, integrationId));
  assert.equal(integration?.lastSyncStatus, "retry");
  assert.equal(integration?.status, "warning");
  assert.equal(integration?.lastSuccessfulSyncAt instanceof Date, true);
});

test("records non-retryable failures and dead letters with sanitized audit history", async () => {
  const failedJob = await startIntegrationJob(scope(), "non_retryable_sync");
  const failed = await markIntegrationJobFailed(scope(), failedJob, new Error("provider rejected the payload"), { retryable: false });
  assert.equal(failed.status, "failed");
  assert.equal(failed.nextRetryAt, null);

  const deadLetterJob = await db.insert(integrationJobsTable).values({
    ...scope(),
    jobType: "dead_letter_sync",
    status: "processing",
    attempts: 3,
    maxAttempts: 3,
  }).returning().then(([job]) => job);
  const deadLettered = await markIntegrationJobFailed(scope(), deadLetterJob, new Error("Bearer super-secret-token"));
  assert.equal(deadLettered.status, "dead_letter");
  assert.equal(deadLettered.deadLetteredAt instanceof Date, true);
  assert.equal(deadLettered.nextRetryAt, null);
  assert.equal(deadLettered.lastError?.includes("super-secret-token"), false);

  const audit = await db.select().from(integrationAuditEventsTable).where(and(
    eq(integrationAuditEventsTable.tenantId, tenantId),
    eq(integrationAuditEventsTable.environmentId, environmentId),
  ));
  assert.equal(audit.some((event) => event.action === "integration_job_retry_scheduled"), true);
  assert.equal(audit.some((event) => event.action === "integration_job_failed"), true);
  assert.equal(audit.some((event) => event.action === "integration_job_dead_lettered"), true);
  assert.equal(audit.every((event) => !event.details.includes("super-secret-token")), true);
});