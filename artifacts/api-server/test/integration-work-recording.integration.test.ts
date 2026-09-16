import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  markIntegrationJobFailed,
  startIntegrationJob,
} from "../src/lib/integrations/job-lifecycle.ts";
import { ObjectStorageService } from "../src/lib/objectStorage.ts";

process.env.APP_ENV = "test";

let connectorMode: "success" | "failure" = "success";
let storedAttachmentCount = 0;
let attachmentStoreDelayMs = 0;
const deletedObjectPaths: string[] = [];

const originalStoreBytes = ObjectStorageService.prototype.storeBytes;
const originalDeleteObject = ObjectStorageService.prototype.deleteObject;
ObjectStorageService.prototype.storeBytes = async function (prefix, bytes, contentType) {
  if (attachmentStoreDelayMs) await new Promise((resolve) => setTimeout(resolve, attachmentStoreDelayMs));
  const stored = await originalStoreBytes.call(this, prefix, bytes, contentType);
  storedAttachmentCount += 1;
  return stored;
};
ObjectStorageService.prototype.deleteObject = async function (objectPath) {
  deletedObjectPaths.push(objectPath);
  return originalDeleteObject.call(this, objectPath);
};

const base64Url = (value: string) => Buffer.from(value, "utf8").toString("base64url");

ReplitConnectors.prototype.proxy = async function (provider, path) {
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
  const isConcurrentMessage = path.includes("/threads/thread-concurrent") || path.includes("/messages/message-concurrent");
  const isPersistenceFailureMessage = path.includes("/threads/thread-persistence-failure") || path.includes("/messages/message-persistence-failure");
  const messageId = isConcurrentMessage ? "message-concurrent" : isPersistenceFailureMessage ? "message-persistence-failure" : "message-1";
  const attachmentId = isPersistenceFailureMessage ? "attachment-duplicate" : "attachment-1";
  if (path.includes(`/messages/${messageId}/attachments/${attachmentId}`)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: base64Url("protected-mailbox-attachment") }),
    };
  }
  if (provider === "outlook") {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "message-1",
        conversationId: "conversation-1",
        subject: "Outlook ITB North Campus",
        from: { emailAddress: { name: "Outlook Bids", address: "outlook-bids@example.com" } },
        receivedDateTime: "2026-09-14T11:00:00Z",
        body: { contentType: "html", content: "<p>Project: North Campus</p><p>Bid due: September 30, 2026</p>" },
        bodyPreview: "Project: North Campus",
        hasAttachments: false,
      }),
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      messages: [{
          id: messageId,
        snippet: "Project: North Campus\nBid due: September 30, 2026",
        date: "2026-09-14T10:00:00Z",
        payload: {
          headers: [
            { name: "From", value: "bids@example.com" },
            { name: "Subject", value: "ITB North Campus" },
          ],
          mimeType: "text/plain",
          body: { data: base64Url("Project: North Campus\nBid due: September 30, 2026") },
          parts: isPersistenceFailureMessage
            ? [
              { filename: "plans-a.pdf", mimeType: "application/pdf", body: { attachmentId, size: 27 } },
              { filename: "plans-b.pdf", mimeType: "application/pdf", body: { attachmentId, size: 27 } },
            ]
            : [
              { filename: "plans.pdf", mimeType: "application/pdf", body: { attachmentId, size: 27 } },
            ],
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
  itbIntakeAttachmentsTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const { default: app } = await import("../src/app.ts");

type Json = Record<string, unknown> | unknown[];

const runId = `${Date.now()}-${process.pid}`;
const clerkUserId = `integration-work-owner-${runId}`;
const otherClerkUserId = `integration-work-other-${runId}`;
let server: Server;
let baseUrl = "";
let tenantId: number;
let environmentId: number;
let otherEnvironmentId: number;
let otherTenantId: number;
let otherTenantEnvironmentId: number;
let userId: number;
let otherUserId: number;
let integrationId: number;

async function request(path: string, init: RequestInit = {}, requestClerkUserId = clerkUserId) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-clerk-user-id": requestClerkUserId,
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
  const [otherEnvironment] = await db.insert(environmentsTable).values({
    tenantId,
    name: "Production",
    slug: `production-${runId}`,
    kind: "production",
    status: "active",
  }).returning();
  otherEnvironmentId = otherEnvironment.id;

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
  await db.insert(tenantEnvironmentAccessTable).values({
    tenantId,
    environmentId: otherEnvironmentId,
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
  await db.insert(integrationEntitlementsTable).values({
    tenantId,
    capabilityKey: "microsoft_365",
    enabled: true,
  });
  await db.insert(integrationsTable).values({
    tenantId,
    environmentId,
    providerKey: "microsoft_365",
    providerCategory: "productivity_collaboration",
    status: "connected",
    connectionType: "replit_managed_oauth",
    configuration: JSON.stringify({ connectorName: "outlook" }),
    credentialsReference: `replit-connector:outlook:test-${runId}`,
  });
  await db.insert(integrationsTable).values({
    tenantId,
    environmentId: otherEnvironmentId,
    providerKey: "google_workspace",
    providerCategory: "productivity_collaboration",
    status: "connected",
    connectionType: "replit_managed_oauth",
    configuration: JSON.stringify({ connectorName: "google-mail" }),
    credentialsReference: `replit-connector:google-mail:production-${runId}`,
  });
  const [otherTenant] = await db.insert(tenantsTable).values({
    name: `Integration Work Other Tenant ${runId}`,
    slug: `integration-work-other-${runId}`,
  }).returning();
  otherTenantId = otherTenant.id;
  const [otherTenantEnvironment] = await db.insert(environmentsTable).values({
    tenantId: otherTenantId,
    name: "Development / Test / Demo",
    slug: `dtd-other-${runId}`,
    kind: "dtd",
    status: "active",
  }).returning();
  otherTenantEnvironmentId = otherTenantEnvironment.id;
  const [otherUser] = await db.insert(usersTable).values({
    clerkUserId: otherClerkUserId,
    email: `${otherClerkUserId}@integration.test`,
    displayName: "Other Tenant Owner",
  }).returning();
  otherUserId = otherUser.id;
  await db.insert(membershipsTable).values({
    tenantId: otherTenantId,
    userId: otherUserId,
    role: "owner",
    environmentAccessConfigured: true,
  });
  await db.insert(tenantEnvironmentAccessTable).values({
    tenantId: otherTenantId,
    environmentId: otherTenantEnvironmentId,
    userId: otherUserId,
    grantedByUserId: otherUserId,
  });
  await db.insert(userTenantContextTable).values({
    userId: otherUserId,
    activeTenantId: otherTenantId,
    activeEnvironmentId: otherTenantEnvironmentId,
  });
  await db.insert(integrationEntitlementsTable).values({
    tenantId: otherTenantId,
    capabilityKey: "google_workspace",
    enabled: true,
  });
  await db.insert(integrationsTable).values({
    tenantId: otherTenantId,
    environmentId: otherTenantEnvironmentId,
    providerKey: "google_workspace",
    providerCategory: "productivity_collaboration",
    status: "connected",
    connectionType: "replit_managed_oauth",
    configuration: JSON.stringify({ connectorName: "google-mail" }),
    credentialsReference: `replit-connector:google-mail:other-tenant-${runId}`,
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
  if (tenantId) await db.delete(platformAuditEventsTable).where(eq(platformAuditEventsTable.tenantId, tenantId));
  if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (otherTenantId) await db.delete(platformAuditEventsTable).where(eq(platformAuditEventsTable.tenantId, otherTenantId));
  if (otherTenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, otherTenantId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(usersTable).where(eq(usersTable.id, otherUserId));
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
  const importedBody = imported.body as {
    id: number;
    sourceType: string;
    sourceBody: string;
    attachments: Array<{ downloadUrl: string; originalName: string; size: number }>;
  };
  assert.equal(importedBody.sourceType, "gmail");
  assert.match(importedBody.sourceBody, /Project: North Campus/);
  assert.deepEqual(importedBody.attachments.map(({ originalName, size }) => ({ originalName, size })), [
    { originalName: "plans.pdf", size: Buffer.byteLength("protected-mailbox-attachment") },
  ]);
  const storedAttachment = await fetch(`${baseUrl}${importedBody.attachments[0].downloadUrl}`, {
    headers: { "x-test-clerk-user-id": clerkUserId },
  });
  assert.equal(storedAttachment.status, 200);
  assert.equal(await storedAttachment.text(), "protected-mailbox-attachment");
  assert.equal(storedAttachmentCount, 1);

  const duplicate = await request("/itb-intakes/mailbox/import", {
    method: "POST",
    body: JSON.stringify({ provider: "google-mail", threadId: "thread-1", messageId: "message-1" }),
  });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
  assert.equal((duplicate.body as { intakeId: number }).intakeId, importedBody.id);
  assert.equal(storedAttachmentCount, 1);

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

test("keeps mailbox duplicate detection scoped by provider, environment, and tenant", async () => {
  const outlook = await request("/itb-intakes/mailbox/import", {
    method: "POST",
    body: JSON.stringify({ provider: "outlook", threadId: "conversation-1", messageId: "message-1" }),
  });
  assert.equal(outlook.status, 201, JSON.stringify(outlook.body));
  const outlookBody = outlook.body as { sourceType: string; sourceBody: string };
  assert.equal(outlookBody.sourceType, "outlook");
  assert.equal(outlookBody.sourceBody, "Project: North Campus Bid due: September 30, 2026");

  const switched = await request("/tenant/environments", {
    method: "POST",
    body: JSON.stringify({ environmentId: otherEnvironmentId }),
  });
  assert.equal(switched.status, 200, JSON.stringify(switched.body));
  const otherEnvironmentImport = await request("/itb-intakes/mailbox/import", {
    method: "POST",
    body: JSON.stringify({ provider: "google-mail", threadId: "thread-1", messageId: "message-1" }),
  });
  assert.equal(otherEnvironmentImport.status, 201, JSON.stringify(otherEnvironmentImport.body));

  const switchedBack = await request("/tenant/environments", {
    method: "POST",
    body: JSON.stringify({ environmentId }),
  });
  assert.equal(switchedBack.status, 200, JSON.stringify(switchedBack.body));

  const otherTenantImport = await request("/itb-intakes/mailbox/import", {
    method: "POST",
    body: JSON.stringify({ provider: "google-mail", threadId: "thread-1", messageId: "message-1" }),
  }, otherClerkUserId);
  assert.equal(otherTenantImport.status, 201, JSON.stringify(otherTenantImport.body));
});

test("serializes concurrent mailbox imports before storing attachments", async () => {
  connectorMode = "success";
  const attachmentCountBefore = storedAttachmentCount;
  attachmentStoreDelayMs = 50;
  try {
    const requests = await Promise.all([
      request("/itb-intakes/mailbox/import", {
        method: "POST",
        body: JSON.stringify({ provider: "google-mail", threadId: "thread-concurrent", messageId: "message-concurrent" }),
      }),
      request("/itb-intakes/mailbox/import", {
        method: "POST",
        body: JSON.stringify({ provider: "google-mail", threadId: "thread-concurrent", messageId: "message-concurrent" }),
      }),
    ]);
    const statuses = requests.map(({ status }) => status).sort((left, right) => left - right);
    assert.deepEqual(statuses, [201, 409], JSON.stringify(requests));
    const createdBody = requests.find(({ status }) => status === 201)!.body as { id: number };
    const conflictBody = requests.find(({ status }) => status === 409)!.body as { intakeId: number };
    assert.equal(conflictBody.intakeId, createdBody.id);
    assert.equal(storedAttachmentCount, attachmentCountBefore + 1);

    const intakes = await db.select().from(itbIntakesTable).where(and(
      eq(itbIntakesTable.tenantId, tenantId),
      eq(itbIntakesTable.environmentId, environmentId),
      eq(itbIntakesTable.sourceProvider, "google-mail"),
      eq(itbIntakesTable.sourceMessageId, "message-concurrent"),
    ));
    assert.equal(intakes.length, 1);
    const attachments = await db.select().from(itbIntakeAttachmentsTable).where(eq(itbIntakeAttachmentsTable.intakeId, intakes[0].id));
    assert.equal(attachments.length, 1);
  } finally {
    attachmentStoreDelayMs = 0;
  }
});

test("cleans stored mailbox objects when intake persistence fails", async () => {
  connectorMode = "success";
  const attachmentCountBefore = storedAttachmentCount;
  const deletedObjectCountBefore = deletedObjectPaths.length;
  const failed = await request("/itb-intakes/mailbox/import", {
    method: "POST",
    body: JSON.stringify({ provider: "google-mail", threadId: "thread-persistence-failure", messageId: "message-persistence-failure" }),
  });
  assert.equal(failed.status, 424, JSON.stringify(failed.body));
  assert.equal(storedAttachmentCount, attachmentCountBefore + 2);
  assert.equal(deletedObjectPaths.length, deletedObjectCountBefore + 2);
  assert.equal(deletedObjectPaths.slice(deletedObjectCountBefore).every((path) => path.startsWith("/objects/")), true);

  const intakes = await db.select().from(itbIntakesTable).where(and(
    eq(itbIntakesTable.tenantId, tenantId),
    eq(itbIntakesTable.environmentId, environmentId),
    eq(itbIntakesTable.sourceProvider, "google-mail"),
    eq(itbIntakesTable.sourceMessageId, "message-persistence-failure"),
  ));
  assert.equal(intakes.length, 0);
});

test("records mailbox failures for retry and keeps connector errors bounded", async () => {
  connectorMode = "failure";
  const failed = await request("/itb-intakes/mailbox/preview?provider=google-mail&q=failure");
  assert.equal(failed.status, 424);
  assert.deepEqual(failed.body, {
    error: "Google Workspace mailbox is not connected or could not be read",
  });
  assert.equal(JSON.stringify(failed.body).includes("message contents"), false);

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