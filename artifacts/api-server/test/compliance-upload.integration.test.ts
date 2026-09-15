import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  db,
  environmentsTable,
  membershipsTable,
  pool,
  tenantEnvironmentAccessTable,
  tenantsTable,
  tradePartnerComplianceDocumentsTable,
  tradePartnersTable,
  userTenantContextTable,
  usersTable,
} from "@workspace/db";
import { ObjectStorageService } from "../src/lib/objectStorage.ts";
import app from "../src/app.ts";

const runId = `${Date.now()}-${process.pid}`;
const clerkUserId = `compliance-upload-${runId}`;
const tenantSlug = `compliance-upload-${runId}`;
const objectStorage = new ObjectStorageService();
const firstPdf = Buffer.from("%PDF-1.7\ncompliance upload one\n", "utf8");
const replacementPdf = Buffer.from("%PDF-1.7\ncompliance upload replacement\n", "utf8");

let server: Server;
let baseUrl = "";
let tenantId: number;
let environmentId: number;
let tradePartnerId: number;
let userId: number;
let uploadedObjectPaths: string[] = [];

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-clerk-user-id": clerkUserId,
      ...init.headers,
    },
  });
  const body = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : await response.arrayBuffer();
  return { response, body: body as Record<string, unknown> };
}

async function putFile(uploadURL: string, file: Buffer) {
  const response = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: file,
  });
  assert.equal(response.ok, true);
}

before(async () => {
  const [tenant] = await db.insert(tenantsTable).values({
    name: "Compliance Upload",
    slug: tenantSlug,
  }).returning();
  tenantId = tenant.id;
  const [environment] = await db.insert(environmentsTable).values({
    tenantId,
    name: "Development / Test / Demo",
    slug: "dtd",
    kind: "dtd",
    status: "active",
  }).returning();
  environmentId = environment.id;
  const [user] = await db.insert(usersTable).values({
    clerkUserId,
    email: `${clerkUserId}@integration.test`,
    displayName: "Compliance Upload",
  }).returning();
  userId = user.id;
  await db.insert(membershipsTable).values({ tenantId, userId: user.id, role: "owner" });
  await db.insert(userTenantContextTable).values({ userId: user.id, activeTenantId: tenantId, activeEnvironmentId: environmentId });
  const [partner] = await db.insert(tradePartnersTable).values({
    companyName: "Upload Test Trade Partner",
    normalizedName: `upload test trade partner ${runId}`,
    tenantId,
    environmentId,
  }).returning();
  tradePartnerId = partner.id;

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
  for (const objectPath of uploadedObjectPaths) await objectStorage.deleteObject(objectPath).catch(() => undefined);
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  await pool.end();
});

test("trade partners can upload, view, and replace scoped compliance documents", async () => {
  const upload = await request(`/trade-partners/${tradePartnerId}/compliance-documents/request-upload`, {
    method: "POST",
    body: JSON.stringify({
      documentType: "insurance_certificate",
      title: "General liability certificate",
      originalName: "liability.pdf",
      contentType: "application/pdf",
      size: firstPdf.length,
    }),
  });
  assert.equal(upload.response.status, 201);
  const pending = upload.body as { id: number; uploadURL: string; objectPath: string; status: string };
  assert.equal(pending.status, "requested");
  assert.match(pending.objectPath, /^\/objects\//);
  uploadedObjectPaths.push(pending.objectPath);

  await putFile(pending.uploadURL, firstPdf);
  const completed = await request(`/trade-partners/${tradePartnerId}/compliance-documents/${pending.id}/complete`, { method: "POST" });
  assert.equal(completed.response.status, 200, JSON.stringify(completed.body));
  assert.equal((completed.body as { status: string }).status, "submitted");

  const downloaded = await request(`/trade-partners/${tradePartnerId}/compliance-documents/${pending.id}/file`);
  assert.equal(downloaded.response.status, 200, JSON.stringify(downloaded.body));
  assert.deepEqual(Buffer.from(downloaded.body as ArrayBuffer), firstPdf);

  const replacement = await request(`/trade-partners/${tradePartnerId}/compliance-documents/${pending.id}/request-replacement`, {
    method: "POST",
    body: JSON.stringify({
      originalName: "liability-renewed.pdf",
      contentType: "application/pdf",
      size: replacementPdf.length,
    }),
  });
  assert.equal(replacement.response.status, 201);
  const replacementPending = replacement.body as { uploadURL: string; objectPath: string };
  uploadedObjectPaths.push(replacementPending.objectPath);
  await putFile(replacementPending.uploadURL, replacementPdf);
  const replacementCompleted = await request(`/trade-partners/${tradePartnerId}/compliance-documents/${pending.id}/complete`, { method: "POST" });
  assert.equal(replacementCompleted.response.status, 200, JSON.stringify(replacementCompleted.body));
  assert.equal((replacementCompleted.body as { originalName: string }).originalName, "liability-renewed.pdf");

  const replacementDownloaded = await request(`/trade-partners/${tradePartnerId}/compliance-documents/${pending.id}/file`);
  assert.equal(replacementDownloaded.response.status, 200, JSON.stringify(replacementDownloaded.body));
  assert.deepEqual(Buffer.from(replacementDownloaded.body as ArrayBuffer), replacementPdf);

  const [row] = await db.select().from(tradePartnerComplianceDocumentsTable).where(eq(tradePartnerComplianceDocumentsTable.id, pending.id));
  assert.equal(row.pendingObjectPath, null);
  assert.equal(row.status, "submitted");
});

test("compliance uploads reject unsafe metadata and incomplete storage", async () => {
  const invalidType = await request(`/trade-partners/${tradePartnerId}/compliance-documents/request-upload`, {
    method: "POST",
    body: JSON.stringify({
      documentType: "insurance_certificate",
      title: "Unsupported file",
      originalName: "script.exe",
      contentType: "application/x-msdownload",
      size: 10,
    }),
  });
  assert.equal(invalidType.response.status, 400);

  const oversized = await request(`/trade-partners/${tradePartnerId}/compliance-documents/request-upload`, {
    method: "POST",
    body: JSON.stringify({
      documentType: "insurance_certificate",
      title: "Oversized file",
      originalName: "large.pdf",
      contentType: "application/pdf",
      size: 104857601,
    }),
  });
  assert.equal(oversized.response.status, 400);

  const pendingUpload = await request(`/trade-partners/${tradePartnerId}/compliance-documents/request-upload`, {
    method: "POST",
    body: JSON.stringify({
      documentType: "insurance_certificate",
      title: "Not uploaded yet",
      originalName: "not-uploaded.pdf",
      contentType: "application/pdf",
      size: firstPdf.length,
    }),
  });
  assert.equal(pendingUpload.response.status, 201);
  const pending = pendingUpload.body as { id: number; objectPath: string };
  uploadedObjectPaths.push(pending.objectPath);
  const incomplete = await request(`/trade-partners/${tradePartnerId}/compliance-documents/${pending.id}/complete`, { method: "POST" });
  assert.equal(incomplete.response.status, 409);
});

test("malware screening rejects a stored file before it becomes submitted", async () => {
  const eicarPdf = Buffer.concat([
    Buffer.from("%PDF-1.7\n", "utf8"),
    Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*", "utf8"),
  ]);
  const upload = await request(`/trade-partners/${tradePartnerId}/compliance-documents/request-upload`, {
    method: "POST",
    body: JSON.stringify({
      documentType: "insurance_certificate",
      title: "Screened file",
      originalName: "screened.pdf",
      contentType: "application/pdf",
      size: eicarPdf.length,
    }),
  });
  assert.equal(upload.response.status, 201);
  const pending = upload.body as { id: number; uploadURL: string; objectPath: string };
  uploadedObjectPaths.push(pending.objectPath);
  await putFile(pending.uploadURL, eicarPdf);

  const completed = await request(`/trade-partners/${tradePartnerId}/compliance-documents/${pending.id}/complete`, { method: "POST" });
  assert.equal(completed.response.status, 422);
  const [row] = await db.select().from(tradePartnerComplianceDocumentsTable).where(eq(tradePartnerComplianceDocumentsTable.id, pending.id));
  assert.equal(row.status, "requested");
});

test("authenticated completion exposes scanner failures and never makes rejected bytes downloadable", async () => {
  const cases = [
    { marker: "MALWARE_TEST_INFECTED", scanStatus: "infected", responseStatus: 422 },
    { marker: "MALWARE_TEST_TIMEOUT", scanStatus: "timeout", responseStatus: 504 },
    { marker: "MALWARE_TEST_UNAVAILABLE", scanStatus: "unavailable", responseStatus: 503 },
  ] as const;

  for (const candidate of cases) {
    const bytes = Buffer.from(`%PDF-1.7\n${candidate.marker}\n`, "utf8");
    const upload = await request(`/trade-partners/${tradePartnerId}/compliance-documents/request-upload`, {
      method: "POST",
      body: JSON.stringify({
        documentType: "insurance_certificate",
        title: `Scanner ${candidate.scanStatus}`,
        originalName: `${candidate.scanStatus}.pdf`,
        contentType: "application/pdf",
        size: bytes.length,
      }),
    });
    assert.equal(upload.response.status, 201, JSON.stringify(upload.body));
    const pending = upload.body as { id: number; uploadURL: string; objectPath: string };
    uploadedObjectPaths.push(pending.objectPath);
    await putFile(pending.uploadURL, bytes);

    const completed = await request(`/trade-partners/${tradePartnerId}/compliance-documents/${pending.id}/complete`, { method: "POST" });
    assert.equal(completed.response.status, candidate.responseStatus, JSON.stringify(completed.body));
    assert.equal((completed.body as { scanStatus: string }).scanStatus, candidate.scanStatus);

    const detail = await request(`/trade-partners/${tradePartnerId}`);
    const document = (detail.body as { complianceDocuments: Array<{ id: number; status: string; scanStatus: string; scanMessage: string }> })
      .complianceDocuments.find((item) => item.id === pending.id);
    assert(document);
    assert.equal(document.status, "requested");
    assert.equal(document.scanStatus, candidate.scanStatus);
    assert.match(document.scanMessage, /security scan/i);

    const download = await request(`/trade-partners/${tradePartnerId}/compliance-documents/${pending.id}/file`);
    assert.equal(download.response.status, 404);
  }
});

test("failed replacement keeps the previously submitted file and partner scope is enforced", async () => {
  const current = await db.select().from(tradePartnerComplianceDocumentsTable)
    .where(eq(tradePartnerComplianceDocumentsTable.tradePartnerId, tradePartnerId));
  const existing = current.find((document) => document.status === "submitted");
  assert(existing);

  const replacement = await request(`/trade-partners/${tradePartnerId}/compliance-documents/${existing.id}/request-replacement`, {
    method: "POST",
    body: JSON.stringify({
      originalName: "replacement-not-uploaded.pdf",
      contentType: "application/pdf",
      size: replacementPdf.length,
    }),
  });
  assert.equal(replacement.response.status, 201);
  const [replacementRow] = await db.select().from(tradePartnerComplianceDocumentsTable)
    .where(eq(tradePartnerComplianceDocumentsTable.id, existing.id));
  if (replacementRow.pendingObjectPath) uploadedObjectPaths.push(replacementRow.pendingObjectPath);

  const incomplete = await request(`/trade-partners/${tradePartnerId}/compliance-documents/${existing.id}/complete`, { method: "POST" });
  assert.equal(incomplete.response.status, 409);
  const stillAvailable = await request(`/trade-partners/${tradePartnerId}/compliance-documents/${existing.id}/file`);
  assert.equal(stillAvailable.response.status, 200);
  assert.deepEqual(Buffer.from(stillAvailable.body as ArrayBuffer), replacementPdf);

  const wrongPartner = await db.insert(tradePartnersTable).values({
    companyName: "Other upload partner",
    normalizedName: `other upload partner ${runId}`,
    tenantId,
    environmentId,
  }).returning();
  const unauthorized = await request(`/trade-partners/${wrongPartner[0].id}/compliance-documents/${existing.id}/file`);
  assert.equal(unauthorized.response.status, 404);

  const [otherEnvironment] = await db.insert(environmentsTable).values({
    tenantId,
    name: `Production ${runId}`,
    slug: `production-${runId}`,
    kind: "production",
    status: "active",
  }).returning();
  await db.insert(tenantEnvironmentAccessTable).values([
    { tenantId, environmentId, userId, grantedByUserId: userId },
    { tenantId, environmentId: otherEnvironment.id, userId, grantedByUserId: userId },
  ]).onConflictDoNothing();
  const switchEnvironment = await request("/tenant/environments", {
    method: "POST",
    body: JSON.stringify({ environmentId: otherEnvironment.id }),
  });
  assert.equal(switchEnvironment.response.status, 200);
  const wrongEnvironment = await request(`/trade-partners/${tradePartnerId}/compliance-documents/${existing.id}/file`);
  assert.equal(wrongEnvironment.response.status, 404);
  const restoreEnvironment = await request("/tenant/environments", {
    method: "POST",
    body: JSON.stringify({ environmentId }),
  });
  assert.equal(restoreEnvironment.response.status, 200);
});