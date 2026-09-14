import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import {
  db,
  environmentsTable,
  itbDocumentsTable,
  itbIntakesTable,
  membershipsTable,
  pool,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} from "@workspace/db";
import { ObjectStorageService } from "../src/lib/objectStorage.ts";
import app from "../src/app.ts";

process.env.APP_ENV = "test";

const runId = `${Date.now()}-${process.pid}`;
const ownerClerkId = `itb-documents-owner-${runId}`;
const otherEnvironmentClerkId = `itb-documents-environment-${runId}`;
const otherTenantClerkId = `itb-documents-other-${runId}`;
const objectStorage = new ObjectStorageService();
const sourceBytes = Buffer.from(
  "Project: Protected Campus Renovation\nIssuer: Safe Builder\nBid due: 2026-09-30\n",
  "utf8",
);
const malformedPdf = Buffer.from("not a valid PDF DOCUMENT_CONTENT_SENTINEL", "utf8");
const documentContentSentinel = "DOCUMENT_CONTENT_SENTINEL";

let server: Server;
let baseUrl = "";
let tenantId: number;
let environmentId: number;
let otherEnvironmentId: number;
let otherTenantId: number;
let sourceObjectPath = "";
let failureObjectPath = "";
let intakeId: number;
let attachmentId: number;
let documentId: number;
let failureIntakeId: number;
let failureAttachmentId: number;
let failureDocumentId: number;

async function request(clerkUserId: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-clerk-user-id": clerkUserId,
      ...init.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.arrayBuffer();
  return { response, body };
}

async function createIntake(
  clerkUserId: string,
  objectPath: string,
  originalName: string,
  contentType: string,
  size: number,
) {
  return request(clerkUserId, "/itb-intakes", {
    method: "POST",
    body: JSON.stringify({
      sourceType: "manual",
      sourceSubject: `Document flow ${originalName}`,
      sourceBody: `Source for ${originalName}`,
      attachments: [{ originalName, contentType, size, objectPath }],
    }),
  });
}

async function uploadObject(bytes: Buffer, contentType: string) {
  const pendingResponse = await request(ownerClerkId, "/itb-intakes/attachments/request-upload", {
    method: "POST",
    body: JSON.stringify({
      originalName: contentType === "application/pdf" ? "broken.pdf" : "invitation.txt",
      contentType,
      size: bytes.length,
    }),
  });
  assert.equal(pendingResponse.response.status, 200, JSON.stringify(pendingResponse.body));
  const pending = pendingResponse.body as { uploadURL: string; objectPath: string };
  const uploaded = await fetch(pending.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes,
  });
  assert.equal(uploaded.ok, true);
  return pending.objectPath;
}

before(async () => {
  const [tenant] = await db.insert(tenantsTable).values({
    name: "ITB Document Flow",
    slug: `itb-documents-${runId}`,
  }).returning();
  tenantId = tenant.id;

  const [environment, otherEnvironment] = await db.insert(environmentsTable).values([
    { tenantId, name: "Development / Test / Demo", slug: `dtd-${runId}`, kind: "dtd", status: "active" },
    { tenantId, name: "Production", slug: `production-${runId}`, kind: "production", status: "active" },
  ]).returning();
  environmentId = environment.id;
  otherEnvironmentId = otherEnvironment.id;

  const [otherTenant] = await db.insert(tenantsTable).values({
    name: "Other ITB Document Flow",
    slug: `itb-documents-other-${runId}`,
  }).returning();
  otherTenantId = otherTenant.id;
  const [otherTenantEnvironment] = await db.insert(environmentsTable).values({
    tenantId: otherTenantId,
    name: "Development / Test / Demo",
    slug: `dtd-other-${runId}`,
    kind: "dtd",
    status: "active",
  }).returning();

  const [owner, otherEnvironmentUser, otherTenantUser] = await db.insert(usersTable).values([
    { clerkUserId: ownerClerkId, email: `${ownerClerkId}@integration.test`, displayName: "ITB Document Owner" },
    { clerkUserId: otherEnvironmentClerkId, email: `${otherEnvironmentClerkId}@integration.test`, displayName: "ITB Other Environment" },
    { clerkUserId: otherTenantClerkId, email: `${otherTenantClerkId}@integration.test`, displayName: "ITB Other Tenant" },
  ]).returning();
  await db.insert(membershipsTable).values([
    { tenantId, userId: owner.id, role: "owner" },
    { tenantId, userId: otherEnvironmentUser.id, role: "member" },
    { tenantId: otherTenantId, userId: otherTenantUser.id, role: "owner" },
  ]);
  await db.insert(userTenantContextTable).values([
    { userId: owner.id, activeTenantId: tenantId, activeEnvironmentId: environmentId },
    { userId: otherEnvironmentUser.id, activeTenantId: tenantId, activeEnvironmentId: otherEnvironmentId },
    { userId: otherTenantUser.id, activeTenantId: otherTenantId, activeEnvironmentId: otherTenantEnvironment.id },
  ]);

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  sourceObjectPath = await uploadObject(sourceBytes, "text/plain");
  failureObjectPath = await uploadObject(malformedPdf, "application/pdf");
});

after(async () => {
  await objectStorage.deleteObject(sourceObjectPath).catch(() => undefined);
  await objectStorage.deleteObject(failureObjectPath).catch(() => undefined);
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (otherTenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, otherTenantId));
  await pool.end();
});

test("creates, downloads, reviews, and explicitly applies a scoped document", async () => {
  const intake = await createIntake(ownerClerkId, sourceObjectPath, "invitation.txt", "text/plain", sourceBytes.length);
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  intakeId = (intake.body as { id: number }).id;
  attachmentId = (intake.body as { attachments: Array<{ id: number }> }).attachments[0].id;

  const document = await request(ownerClerkId, `/itb-intakes/${intakeId}/documents`, {
    method: "POST",
    body: JSON.stringify({ attachmentId }),
  });
  assert.equal(document.response.status, 201, JSON.stringify(document.body));
  const parsedDocument = document.body as {
    id: number;
    status: string;
    attemptCount: number;
    findings: Array<{ key: string; status: string; page?: number }>;
  };
  documentId = parsedDocument.id;
  assert.equal(parsedDocument.status, "completed");
  assert.equal(parsedDocument.attemptCount, 1);
  assert.ok(parsedDocument.findings.some((finding) => finding.key === "project_name" && finding.status === "proposed"));

  const downloaded = await request(ownerClerkId, `/itb-intakes/${intakeId}/attachments/${attachmentId}`);
  assert.equal(downloaded.response.status, 200);
  assert.deepEqual(Buffer.from(downloaded.body as ArrayBuffer), sourceBytes);

  await objectStorage.deleteObject(sourceObjectPath);
  const missingObject = await request(ownerClerkId, `/itb-intakes/${intakeId}/attachments/${attachmentId}`);
  assert.equal(missingObject.response.status, 404);
  assert.equal((missingObject.body as { error?: string }).error, "Attachment object not found");

  const duplicate = await request(ownerClerkId, `/itb-intakes/${intakeId}/documents`, {
    method: "POST",
    body: JSON.stringify({ attachmentId }),
  });
  assert.equal(duplicate.response.status, 409);

  const review = await request(ownerClerkId, `/itb-intakes/${intakeId}/documents/${documentId}/findings`, {
    method: "PATCH",
    body: JSON.stringify({ key: "project_name", status: "accepted" }),
  });
  assert.equal(review.response.status, 200, JSON.stringify(review.body));
  assert.equal(
    (review.body as { findings: Array<{ key: string; status: string }> }).findings.find((finding) => finding.key === "project_name")?.status,
    "accepted",
  );

  const applied = await request(ownerClerkId, `/itb-intakes/${intakeId}/documents/${documentId}/apply`, { method: "POST" });
  assert.equal(applied.response.status, 200, JSON.stringify(applied.body));
  const [savedIntake] = await db.select().from(itbIntakesTable).where(eq(itbIntakesTable.id, intakeId));
  const extraction = JSON.parse(savedIntake.extractionJson) as { projectName?: { value?: string } };
  assert.equal(extraction.projectName?.value, "Protected Campus Renovation");
  assert.equal(savedIntake.opportunityId, null);
  assert.equal(savedIntake.bidId, null);
});

test("failed parser results can retry only until the bounded attempt limit", async () => {
  const intake = await createIntake(ownerClerkId, failureObjectPath, "broken.pdf", "application/pdf", malformedPdf.length);
  assert.equal(intake.response.status, 201, JSON.stringify(intake.body));
  failureIntakeId = (intake.body as { id: number }).id;
  failureAttachmentId = (intake.body as { attachments: Array<{ id: number }> }).attachments[0].id;

  const first = await request(ownerClerkId, `/itb-intakes/${failureIntakeId}/documents`, {
    method: "POST",
    body: JSON.stringify({ attachmentId: failureAttachmentId }),
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  failureDocumentId = (first.body as { id: number }).id;
  assert.equal((first.body as { status: string; attemptCount: number }).status, "failed");
  assert.equal((first.body as { attemptCount: number }).attemptCount, 1);
  assert.equal((first.body as { errorMessage?: string | null }).errorMessage?.includes(documentContentSentinel), false);

  const second = await request(ownerClerkId, `/itb-intakes/${failureIntakeId}/documents/${failureDocumentId}/retry`, { method: "POST" });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.equal((second.body as { status: string; attemptCount: number }).status, "failed");
  assert.equal((second.body as { attemptCount: number }).attemptCount, 2);

  const third = await request(ownerClerkId, `/itb-intakes/${failureIntakeId}/documents/${failureDocumentId}/retry`, { method: "POST" });
  assert.equal(third.response.status, 200, JSON.stringify(third.body));
  assert.equal((third.body as { attemptCount: number }).attemptCount, 3);

  const exhausted = await request(ownerClerkId, `/itb-intakes/${failureIntakeId}/documents/${failureDocumentId}/retry`, { method: "POST" });
  assert.equal(exhausted.response.status, 409);
});

test("rejects document and protected object access across tenants and environments", async () => {
  const sameTenantOtherEnvironment = await request(
    otherEnvironmentClerkId,
    `/itb-intakes/${intakeId}/documents`,
  );
  assert.equal(sameTenantOtherEnvironment.response.status, 200);
  assert.deepEqual(sameTenantOtherEnvironment.body, []);

  const wrongEnvironmentDocument = await request(
    otherEnvironmentClerkId,
    `/itb-intakes/${intakeId}/documents/${documentId}/retry`,
    { method: "POST" },
  );
  assert.equal(wrongEnvironmentDocument.response.status, 404);

  const wrongEnvironmentAttachment = await request(
    otherEnvironmentClerkId,
    `/itb-intakes/${intakeId}/attachments/${attachmentId}`,
  );
  assert.equal(wrongEnvironmentAttachment.response.status, 404);

  const otherTenantDocumentList = await request(
    otherTenantClerkId,
    `/itb-intakes/${intakeId}/documents`,
  );
  assert.equal(otherTenantDocumentList.response.status, 200);
  assert.deepEqual(otherTenantDocumentList.body, []);

  const otherTenantAttachment = await request(
    otherTenantClerkId,
    `/itb-intakes/${intakeId}/attachments/${attachmentId}`,
  );
  assert.equal(otherTenantAttachment.response.status, 404);

  const otherTenantDocumentRetry = await request(
    otherTenantClerkId,
    `/itb-intakes/${intakeId}/documents/${documentId}/retry`,
    { method: "POST" },
  );
  assert.equal(otherTenantDocumentRetry.response.status, 404);

  const crossScopeDocument = await db.select().from(itbDocumentsTable).where(and(
    eq(itbDocumentsTable.id, documentId),
    eq(itbDocumentsTable.tenantId, tenantId),
    eq(itbDocumentsTable.environmentId, environmentId),
  ));
  assert.equal(crossScopeDocument.length, 1);
});