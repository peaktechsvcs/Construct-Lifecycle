import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import {
  bidsTable,
  businessCustomersTable,
  db,
  environmentsTable,
  itbDocumentEvidenceMappingsTable,
  itbDocumentsTable,
  itbIntakeAttachmentsTable,
  itbIntakesTable,
  membershipsTable,
  opportunitiesTable,
  platformAuditEventsTable,
  pool,
  projectsTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} from "@workspace/db";
import app from "../src/app.ts";

const runId = `${Date.now()}-${process.pid}`;
const clerkUserId = `itb-evidence-${runId}`;
const tenantSlug = `itb-evidence-${runId}`;
const otherTenantSlug = `itb-evidence-other-${runId}`;

let server: Server;
let baseUrl = "";
let tenantId: number;
let environmentId: number;
let intakeId: number;
let documentId: number;
let opportunityId: number;
let bidId: number;
let projectId: number;
let otherOpportunityId: number;
let otherEnvironmentOpportunityId: number;

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
    : await response.text();
  return { response, body };
}

const findings = [
  { key: "project_name", label: "Project name", value: "North Campus Renovation", confidence: 0.95, evidence: "Project: North Campus Renovation", status: "accepted" },
  { key: "estimated_value", label: "Estimated value", value: "250000", confidence: 0.9, evidence: "Estimated value: $250,000", status: "corrected", correctedValue: "275000" },
  { key: "location", label: "Location", value: "100 Main Street", confidence: 0.9, evidence: "Jobsite: 100 Main Street", status: "accepted" },
  { key: "bid_due_date", label: "Bid due date", value: "2026-10-01", confidence: 0.9, evidence: "Bid due: October 1, 2026", status: "corrected", correctedValue: "2026-10-15" },
  { key: "issuer", label: "Issuer", value: "Unreviewed issuer", confidence: 0.5, evidence: "Issuer: Unreviewed issuer", status: "proposed" },
];

before(async () => {
  const [tenant] = await db.insert(tenantsTable).values({ name: "ITB Evidence", slug: tenantSlug }).returning();
  tenantId = tenant.id;
  const [environment] = await db.insert(environmentsTable).values({
    tenantId, name: "Development / Test / Demo", slug: "dtd", kind: "dtd", status: "active",
  }).returning();
  environmentId = environment.id;
  const [user] = await db.insert(usersTable).values({
    clerkUserId, email: `${clerkUserId}@integration.test`, displayName: "ITB Evidence Reviewer",
  }).returning();
  await db.insert(membershipsTable).values({ tenantId, userId: user.id, role: "owner" });
  await db.insert(userTenantContextTable).values({ userId: user.id, activeTenantId: tenantId, activeEnvironmentId: environmentId });

  const [customer] = await db.insert(businessCustomersTable).values({
    tenantId, environmentId, companyName: "North Campus Owner", normalizedName: `north-campus-owner-${runId}`,
  }).returning();
  const [opportunity] = await db.insert(opportunitiesTable).values({
    tenantId, environmentId, businessCustomerId: customer.id, opportunityNumber: `OP-EVIDENCE-${runId}`,
    name: "North Campus Opportunity", estimatedValue: "100000",
  }).returning();
  opportunityId = opportunity.id;
  const [bid] = await db.insert(bidsTable).values({
    tenantId, environmentId, businessCustomerId: customer.id, opportunityId,
    bidNumber: `BID-EVIDENCE-${runId}`, name: "North Campus Bid",
  }).returning();
  bidId = bid.id;
  const [project] = await db.insert(projectsTable).values({
    tenantId, environmentId, businessCustomerId: customer.id, customerName: customer.companyName,
    projectNumber: `CP-EVIDENCE-${runId}`, projectName: "North Campus Project", category: "commercial",
  }).returning();
  projectId = project.id;
  const [otherEnvironment] = await db.insert(environmentsTable).values({
    tenantId, name: "Other Environment", slug: `other-${runId}`, kind: "dtd", status: "active",
  }).returning();
  const [otherEnvironmentCustomer] = await db.insert(businessCustomersTable).values({
    tenantId, environmentId: otherEnvironment.id, companyName: "Other Environment Owner", normalizedName: `other-environment-owner-${runId}`,
  }).returning();
  const [otherEnvironmentOpportunity] = await db.insert(opportunitiesTable).values({
    tenantId, environmentId: otherEnvironment.id, businessCustomerId: otherEnvironmentCustomer.id,
    opportunityNumber: `OP-OTHER-ENV-${runId}`, name: "Other Environment Opportunity", estimatedValue: "1",
  }).returning();
  otherEnvironmentOpportunityId = otherEnvironmentOpportunity.id;

  const [intake] = await db.insert(itbIntakesTable).values({
    tenantId, environmentId, sourceFingerprint: `evidence-${runId}`, sourceBody: "ITB source",
    status: "approved", businessCustomerId: customer.id, opportunityId, bidId,
  }).returning();
  intakeId = intake.id;
  const [attachment] = await db.insert(itbIntakeAttachmentsTable).values({
    intakeId, originalName: "invitation.txt", contentType: "text/plain", size: 100, objectPath: `/objects/itb-evidence-${runId}`,
  }).returning();
  const [document] = await db.insert(itbDocumentsTable).values({
    tenantId, environmentId, intakeId, attachmentId: attachment.id, role: "itb_invitation",
    status: "completed", parser: "test", parserVersion: "test", sha256: `sha-${runId}`,
    byteSize: 100, findingsJson: JSON.stringify(findings), createdByUserId: user.id,
  }).returning();
  documentId = document.id;

  const [otherTenant] = await db.insert(tenantsTable).values({ name: "Other ITB Evidence", slug: otherTenantSlug }).returning();
  const [otherTenantEnvironment] = await db.insert(environmentsTable).values({
    tenantId: otherTenant.id, name: "Development / Test / Demo", slug: "dtd", kind: "dtd", status: "active",
  }).returning();
  const [otherCustomer] = await db.insert(businessCustomersTable).values({
    tenantId: otherTenant.id, environmentId: otherTenantEnvironment.id, companyName: "Other Owner", normalizedName: `other-owner-${runId}`,
  }).returning();
  const [otherOpportunity] = await db.insert(opportunitiesTable).values({
    tenantId: otherTenant.id, environmentId: otherTenantEnvironment.id, businessCustomerId: otherCustomer.id,
    opportunityNumber: `OP-OTHER-${runId}`, name: "Other Tenant Opportunity", estimatedValue: "1",
  }).returning();
  otherOpportunityId = otherOpportunity.id;

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
  await db.delete(tenantsTable).where(eq(tenantsTable.slug, otherTenantSlug));
  await pool.end();
});

test("maps reviewed evidence to existing opportunity, bid, and project records", async () => {
  const beforeCounts = {
    opportunities: (await db.select().from(opportunitiesTable).where(and(eq(opportunitiesTable.tenantId, tenantId), eq(opportunitiesTable.environmentId, environmentId)))).length,
    bids: (await db.select().from(bidsTable).where(and(eq(bidsTable.tenantId, tenantId), eq(bidsTable.environmentId, environmentId)))).length,
    projects: (await db.select().from(projectsTable).where(and(eq(projectsTable.tenantId, tenantId), eq(projectsTable.environmentId, environmentId)))).length,
  };

  const opportunityMapping = await request(`/itb-intakes/${intakeId}/documents/${documentId}/evidence-mappings`, {
    method: "POST",
    body: JSON.stringify({
      targetType: "opportunity", targetId: opportunityId,
      mappings: [
        { findingKey: "project_name", targetField: "name" },
        { findingKey: "estimated_value", targetField: "estimatedValue" },
      ],
    }),
  });
  assert.equal(opportunityMapping.response.status, 200, JSON.stringify(opportunityMapping.body));
  assert.equal((opportunityMapping.body as Array<unknown>).length, 2);

  const repeated = await request(`/itb-intakes/${intakeId}/documents/${documentId}/evidence-mappings`, {
    method: "POST",
    body: JSON.stringify({
      targetType: "opportunity", targetId: opportunityId,
      mappings: [{ findingKey: "project_name", targetField: "name" }],
    }),
  });
  assert.equal(repeated.response.status, 200);
  assert.equal((repeated.body as Array<unknown>).length, 2);

  const bidMapping = await request(`/itb-intakes/${intakeId}/documents/${documentId}/evidence-mappings`, {
    method: "POST",
    body: JSON.stringify({
      targetType: "bid", targetId: bidId,
      mappings: [{ findingKey: "bid_due_date", targetField: "dueDate" }],
    }),
  });
  assert.equal(bidMapping.response.status, 200, JSON.stringify(bidMapping.body));

  const projectMapping = await request(`/itb-intakes/${intakeId}/documents/${documentId}/evidence-mappings`, {
    method: "POST",
    body: JSON.stringify({
      targetType: "project", targetId: projectId,
      mappings: [{ findingKey: "location", targetField: "address" }],
    }),
  });
  assert.equal(projectMapping.response.status, 200, JSON.stringify(projectMapping.body));

  const afterCounts = {
    opportunities: (await db.select().from(opportunitiesTable).where(and(eq(opportunitiesTable.tenantId, tenantId), eq(opportunitiesTable.environmentId, environmentId)))).length,
    bids: (await db.select().from(bidsTable).where(and(eq(bidsTable.tenantId, tenantId), eq(bidsTable.environmentId, environmentId)))).length,
    projects: (await db.select().from(projectsTable).where(and(eq(projectsTable.tenantId, tenantId), eq(projectsTable.environmentId, environmentId)))).length,
  };
  assert.deepEqual(afterCounts, beforeCounts);

  const [opportunity] = await db.select().from(opportunitiesTable).where(eq(opportunitiesTable.id, opportunityId));
  const [bid] = await db.select().from(bidsTable).where(eq(bidsTable.id, bidId));
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  assert.equal(opportunity.name, "North Campus Renovation");
  assert.equal(Number(opportunity.estimatedValue), 275000);
  assert.equal(bid.dueDate, "2026-10-15");
  assert.equal(project.address, "100 Main Street");

  const mappings = await request(`/itb-intakes/${intakeId}/documents/${documentId}/evidence-mappings`);
  assert.equal(mappings.response.status, 200);
  assert.equal((mappings.body as Array<unknown>).length, 4);
  const audit = await db.select().from(platformAuditEventsTable).where(and(
    eq(platformAuditEventsTable.tenantId, tenantId),
    eq(platformAuditEventsTable.action, "itb_document_evidence_mapped"),
  ));
  assert.equal(audit.length, 4);
});

test("rejects unreviewed, invalid, and out-of-scope evidence mappings", async () => {
  const proposed = await request(`/itb-intakes/${intakeId}/documents/${documentId}/evidence-mappings`, {
    method: "POST",
    body: JSON.stringify({ targetType: "opportunity", targetId: opportunityId, mappings: [{ findingKey: "issuer", targetField: "name" }] }),
  });
  assert.equal(proposed.response.status, 409);

  const invalidField = await request(`/itb-intakes/${intakeId}/documents/${documentId}/evidence-mappings`, {
    method: "POST",
    body: JSON.stringify({ targetType: "bid", targetId: bidId, mappings: [{ findingKey: "location", targetField: "dueDate" }] }),
  });
  assert.equal(invalidField.response.status, 400);

  const outOfScope = await request(`/itb-intakes/${intakeId}/documents/${documentId}/evidence-mappings`, {
    method: "POST",
    body: JSON.stringify({ targetType: "opportunity", targetId: otherOpportunityId, mappings: [{ findingKey: "project_name", targetField: "name" }] }),
  });
  assert.equal(outOfScope.response.status, 404);

  const wrongEnvironment = await request(`/itb-intakes/${intakeId}/documents/${documentId}/evidence-mappings`, {
    method: "POST",
    body: JSON.stringify({ targetType: "opportunity", targetId: otherEnvironmentOpportunityId, mappings: [{ findingKey: "project_name", targetField: "name" }] }),
  });
  assert.equal(wrongEnvironment.response.status, 404);

  const wrongLink = await request(`/itb-intakes/${intakeId}/documents/${documentId}/evidence-mappings`, {
    method: "POST",
    body: JSON.stringify({ targetType: "bid", targetId: opportunityId, mappings: [{ findingKey: "project_name", targetField: "name" }] }),
  });
  assert.equal(wrongLink.response.status, 404);

  const [mapping] = await db.select().from(itbDocumentEvidenceMappingsTable).where(eq(itbDocumentEvidenceMappingsTable.documentId, documentId));
  assert(mapping);
});