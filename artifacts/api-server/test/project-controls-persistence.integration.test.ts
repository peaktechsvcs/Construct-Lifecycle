import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";

process.env.APP_ENV = "test";

const {
  db,
  contractParticipantsTable,
  environmentsTable,
  membershipsTable,
  pool,
  projectChangeOrdersTable,
  projectContractsTable,
  projectControlEventsTable,
  projectsTable,
  tenantEnvironmentAccessTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const { default: app } = await import("../src/app.ts");

const runId = `${Date.now()}-${process.pid}`;
const clerkIds = {
  ownerA: `controls-owner-a-${runId}`,
  productionOwnerA: `controls-production-owner-a-${runId}`,
  ownerB: `controls-owner-b-${runId}`,
  adminA: `controls-admin-a-${runId}`,
  memberA: `controls-member-a-${runId}`,
  platformAdmin: `controls-platform-admin-${runId}`,
};

type JsonBody = Record<string, unknown> | unknown[];

let server: Server;
let baseUrl = "";
let tenantAId: number;
let tenantBId: number;
let environmentADtdId: number;
let environmentAProductionId: number;
let environmentBDtdId: number;
let projectADtdId: number;
const rollbackParticipantMarker = "__project_controls_forced_failure__";
const rollbackConstraintName = `project_controls_rollback_${runId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
let rollbackConstraintInstalled = false;

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
  let body: JsonBody | string | undefined;
  if (text) {
    try {
      body = JSON.parse(text) as JsonBody;
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

function bodyObject(body: JsonBody | string | undefined) {
  assert.equal(typeof body, "object");
  assert(body !== null);
  assert.equal(Array.isArray(body), false);
  return body as Record<string, unknown>;
}

function jsonBody(value: Record<string, unknown>): RequestInit {
  return { method: "PUT", body: JSON.stringify(value) };
}

before(async () => {
  const [tenantA, tenantB] = await db.insert(tenantsTable).values([
    { name: "Project Controls Persistence A", slug: `controls-persistence-a-${runId}` },
    { name: "Project Controls Persistence B", slug: `controls-persistence-b-${runId}` },
  ]).returning();
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  const [environmentADtd, environmentAProduction, environmentBDtd] = await db.insert(environmentsTable).values([
    { tenantId: tenantAId, name: "Development / Test / Demo", slug: "dtd", kind: "dtd", status: "active" },
    { tenantId: tenantAId, name: "Production", slug: "production", kind: "production", status: "active" },
    { tenantId: tenantBId, name: "Development / Test / Demo", slug: "dtd", kind: "dtd", status: "active" },
  ]).returning();
  environmentADtdId = environmentADtd.id;
  environmentAProductionId = environmentAProduction.id;
  environmentBDtdId = environmentBDtd.id;

  const [ownerA, productionOwnerA, ownerB, adminA, memberA, platformAdmin] = await db.insert(usersTable).values([
    { clerkUserId: clerkIds.ownerA, email: `${clerkIds.ownerA}@integration.test`, displayName: "Controls Owner A" },
    { clerkUserId: clerkIds.productionOwnerA, email: `${clerkIds.productionOwnerA}@integration.test`, displayName: "Controls Production Owner A" },
    { clerkUserId: clerkIds.ownerB, email: `${clerkIds.ownerB}@integration.test`, displayName: "Controls Owner B" },
    { clerkUserId: clerkIds.adminA, email: `${clerkIds.adminA}@integration.test`, displayName: "Controls Admin A" },
    { clerkUserId: clerkIds.memberA, email: `${clerkIds.memberA}@integration.test`, displayName: "Controls Member A" },
    { clerkUserId: clerkIds.platformAdmin, email: `${clerkIds.platformAdmin}@integration.test`, displayName: "Controls Platform Admin", isPlatformAdmin: true },
  ]).returning();

  await db.insert(membershipsTable).values([
    { tenantId: tenantAId, userId: ownerA.id, role: "owner", environmentAccessConfigured: true },
    { tenantId: tenantAId, userId: productionOwnerA.id, role: "owner", environmentAccessConfigured: true },
    { tenantId: tenantBId, userId: ownerB.id, role: "owner", environmentAccessConfigured: true },
    { tenantId: tenantAId, userId: adminA.id, role: "admin", environmentAccessConfigured: true },
    { tenantId: tenantAId, userId: memberA.id, role: "member", environmentAccessConfigured: true },
    { tenantId: tenantAId, userId: platformAdmin.id, role: "admin", environmentAccessConfigured: true },
  ]);
  await db.insert(tenantEnvironmentAccessTable).values([
    { tenantId: tenantAId, environmentId: environmentADtdId, userId: ownerA.id, grantedByUserId: ownerA.id },
    { tenantId: tenantAId, environmentId: environmentAProductionId, userId: ownerA.id, grantedByUserId: ownerA.id },
    { tenantId: tenantAId, environmentId: environmentAProductionId, userId: productionOwnerA.id, grantedByUserId: productionOwnerA.id },
    { tenantId: tenantBId, environmentId: environmentBDtdId, userId: ownerB.id, grantedByUserId: ownerB.id },
    { tenantId: tenantAId, environmentId: environmentADtdId, userId: adminA.id, grantedByUserId: ownerA.id },
    { tenantId: tenantAId, environmentId: environmentADtdId, userId: memberA.id, grantedByUserId: ownerA.id },
    { tenantId: tenantAId, environmentId: environmentADtdId, userId: platformAdmin.id, grantedByUserId: ownerA.id },
  ]);
  await db.insert(userTenantContextTable).values([
    { userId: ownerA.id, activeTenantId: tenantAId, activeEnvironmentId: environmentADtdId },
    { userId: productionOwnerA.id, activeTenantId: tenantAId, activeEnvironmentId: environmentAProductionId },
    { userId: ownerB.id, activeTenantId: tenantBId, activeEnvironmentId: environmentBDtdId },
    { userId: adminA.id, activeTenantId: tenantAId, activeEnvironmentId: environmentADtdId },
    { userId: memberA.id, activeTenantId: tenantAId, activeEnvironmentId: environmentADtdId },
    { userId: platformAdmin.id, activeTenantId: tenantAId, activeEnvironmentId: environmentADtdId },
  ]);

  const [projectA] = await db.insert(projectsTable).values({
    tenantId: tenantAId,
    environmentId: environmentADtdId,
    projectNumber: `CTRL-${runId}-A`,
    customerName: "Controls Customer A",
    projectName: `Controls Persistence ${runId}`,
    category: "commercial",
    stage: "contract",
  }).returning();
  await db.insert(projectsTable).values([
    {
      tenantId: tenantAId,
      environmentId: environmentAProductionId,
      projectNumber: `CTRL-${runId}-AP`,
      customerName: "Controls Production Customer A",
      projectName: `Production Controls ${runId}`,
      category: "commercial",
    },
    {
      tenantId: tenantBId,
      environmentId: environmentBDtdId,
      projectNumber: `CTRL-${runId}-B`,
      customerName: "Controls Customer B",
      projectName: `Other Tenant Controls ${runId}`,
      category: "commercial",
    },
  ]);
  projectADtdId = projectA.id;
  await pool.query(`
    ALTER TABLE contract_participants
    ADD CONSTRAINT "${rollbackConstraintName}"
    CHECK (organization_name <> '${rollbackParticipantMarker}')
  `);
  rollbackConstraintInstalled = true;

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
  if (rollbackConstraintInstalled) {
    await pool.query(`ALTER TABLE contract_participants DROP CONSTRAINT "${rollbackConstraintName}"`);
  }
  if (tenantAId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantAId));
  if (tenantBId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantBId));
  await pool.end();
});

test("contract and milestone edits survive controls reload", async () => {
  const contractPath = `/projects/${projectADtdId}/controls/contract`;
  const controlsPath = `/projects/${projectADtdId}/controls`;
  const contractSave = await request(clerkIds.ownerA, contractPath, jsonBody({
    contractNumber: `CON-${runId}`,
    deliveryMethod: "design_build",
    originalValue: 125000,
    currentValue: 132500,
    contractStart: "2026-10-01",
    contractEnd: "2027-06-30",
    noticeToProceed: "2026-09-15",
    paymentTerms: "Net 45",
    retainagePercent: 5,
    retainageCap: 5000,
    approvalStatus: "pending",
    status: "active",
    documentUrl: "https://example.com/contracts/persistence",
    participants: [
      {
        participantType: "owner",
        organizationName: "Persistence Owner",
        contactName: "Alex Owner",
        contactEmail: "alex.owner@example.com",
        role: "Project executive",
      },
      {
        participantType: "general_contractor",
        organizationName: "Persistence Builder",
        contactName: "Casey Builder",
        contactEmail: "casey.builder@example.com",
        role: "Contract administrator",
      },
    ],
  }));
  assert.equal(contractSave.status, 200, JSON.stringify(contractSave.body));

  const contractUpdate = await request(clerkIds.ownerA, contractPath, jsonBody({
    contractNumber: `CON-${runId}-UPDATED`,
    deliveryMethod: "construction_manager_at_risk",
    originalValue: 125000,
    currentValue: 140000,
    contractStart: "2026-10-15",
    contractEnd: "2027-07-15",
    noticeToProceed: "2026-09-20",
    paymentTerms: "Net 30",
    retainagePercent: 7.5,
    retainageCap: 7000,
    approvalStatus: "approved",
    status: "active",
    documentUrl: "https://example.com/contracts/persistence-updated",
    participants: [
      {
        participantType: "general_contractor",
        organizationName: "Persistence Builder Updated",
        contactName: "Casey Builder",
        contactEmail: "casey.builder@example.com",
        role: "Senior contract administrator",
      },
    ],
  }));
  assert.equal(contractUpdate.status, 200, JSON.stringify(contractUpdate.body));

  const createdMilestone = await request(clerkIds.ownerA, `/projects/${projectADtdId}/controls/schedule`, {
    method: "POST",
    body: JSON.stringify({
      itemNumber: "M-01",
      name: "Substantial Completion",
      itemType: "milestone",
      plannedStart: "2026-11-01",
      plannedEnd: "2027-06-30",
      status: "planned",
      ownerName: "Project Team",
    }),
  });
  assert.equal(createdMilestone.status, 201, JSON.stringify(createdMilestone.body));
  const createdMilestoneBody = bodyObject(createdMilestone.body);
  const milestoneId = createdMilestoneBody.id;
  assert.equal(typeof milestoneId, "number");
  const staleUpdatedAt = createdMilestoneBody.updatedAt;
  assert.equal(typeof staleUpdatedAt, "string");

  const milestoneUpdate = await request(clerkIds.ownerA, `/projects/${projectADtdId}/controls/schedule/${milestoneId}`, {
    method: "PATCH",
    body: JSON.stringify({
      itemNumber: "M-01",
      name: "Substantial Completion Achieved",
      itemType: "milestone",
      plannedStart: "2026-11-15",
      plannedEnd: "2027-07-15",
      actualStart: "2026-11-20",
      actualEnd: "2027-07-20",
      status: "complete",
      ownerName: "Closeout Team",
       expectedUpdatedAt: staleUpdatedAt,
    }),
  });
  assert.equal(milestoneUpdate.status, 200, JSON.stringify(milestoneUpdate.body));
  const milestoneUpdateBody = bodyObject(milestoneUpdate.body);

  const crossEnvironmentMilestoneUpdate = await request(clerkIds.productionOwnerA, `/projects/${projectADtdId}/controls/schedule/${milestoneId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: "Cross-environment mutation",
      status: "delayed",
         expectedUpdatedAt: milestoneUpdateBody.updatedAt,
    }),
  });
  assert.equal(crossEnvironmentMilestoneUpdate.status, 404);

  const concurrentMilestoneUpdate = await request(clerkIds.ownerA, `/projects/${projectADtdId}/controls/schedule/${milestoneId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: "Newer server value",
      expectedUpdatedAt: milestoneUpdateBody.updatedAt,
    }),
  });
  assert.equal(concurrentMilestoneUpdate.status, 200, JSON.stringify(concurrentMilestoneUpdate.body));

  const staleMilestoneUpdate = await request(clerkIds.ownerA, `/projects/${projectADtdId}/controls/schedule/${milestoneId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: "Stale overwrite attempt",
      expectedUpdatedAt: milestoneUpdateBody.updatedAt,
    }),
  });
  assert.equal(staleMilestoneUpdate.status, 409, JSON.stringify(staleMilestoneUpdate.body));
  assert.deepEqual(staleMilestoneUpdate.body, {
    error: "This schedule item changed since you opened it",
    code: "SCHEDULE_ITEM_CONFLICT",
  });

  const reloaded = await request(clerkIds.ownerA, controlsPath);
  assert.equal(reloaded.status, 200, JSON.stringify(reloaded.body));
  const controls = bodyObject(reloaded.body);
  const contract = bodyObject(controls.contract);
  assert.equal(contract.contractNumber, `CON-${runId}-UPDATED`);
  assert.equal(contract.deliveryMethod, "construction_manager_at_risk");
  assert.equal(contract.originalValue, 125000);
  assert.equal(contract.currentValue, 140000);
  assert.equal(contract.contractStart, "2026-10-15");
  assert.equal(contract.contractEnd, "2027-07-15");
  assert.equal(contract.noticeToProceed, "2026-09-20");
  assert.equal(contract.paymentTerms, "Net 30");
  assert.equal(contract.retainagePercent, 7.5);
  assert.equal(contract.retainageCap, 7000);
  assert.equal(contract.approvalStatus, "approved");
  assert.equal(contract.documentUrl, "https://example.com/contracts/persistence-updated");
  const participants = contract.participants as Array<Record<string, unknown>>;
  assert.equal(participants.length, 1);
  assert.equal(participants[0]?.participantType, "general_contractor");
  assert.equal(participants[0]?.organizationName, "Persistence Builder Updated");
  assert.equal(participants[0]?.contactName, "Casey Builder");
  assert.equal(participants[0]?.contactEmail, "casey.builder@example.com");
  assert.equal(participants[0]?.role, "Senior contract administrator");

  const scheduleItems = controls.scheduleItems as Array<Record<string, unknown>>;
  const milestone = scheduleItems.find((item) => item.id === milestoneId);
  assert(milestone);
  assert.equal(milestone.itemNumber, "M-01");
   assert.equal(milestone.name, "Newer server value");
  assert.equal(milestone.plannedStart, "2026-11-15");
  assert.equal(milestone.plannedEnd, "2027-07-15");
  assert.equal(milestone.actualStart, "2026-11-20");
  assert.equal(milestone.actualEnd, "2027-07-20");
  assert.equal(milestone.status, "complete");
  assert.equal(milestone.ownerName, "Closeout Team");
});

test("change order approval decisions enforce roles, transitions, and scope", async () => {
  const changeOrdersPath = `/projects/${projectADtdId}/controls/change-orders`;
  const changeOrderBody = (changeNumber: string, title: string) => ({
    changeNumber,
    changeType: "change_order",
    title,
    description: "API approval boundary coverage",
    status: "under_review",
    proposedValue: 12500,
    scheduleImpactDays: 2,
    requestedBy: "Controls Member A",
  });
  const createPending = async (changeNumber: string, title: string) => {
    const response = await request(clerkIds.memberA, changeOrdersPath, {
      method: "POST",
      body: JSON.stringify(changeOrderBody(changeNumber, title)),
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const body = bodyObject(response.body);
    assert.equal(body.approvalStatus, "pending");
    assert.equal(body.status, "under_review");
    assert.equal(typeof body.id, "number");
    return body;
  };

  const memberCreated = await createPending(`CO-${runId}-MEMBER`, "Member editable change");
  const memberChangeOrderId = memberCreated.id as number;
  const memberApproval = await request(clerkIds.memberA, `${changeOrdersPath}/${memberChangeOrderId}`, {
    method: "PATCH",
    body: JSON.stringify({ approvalStatus: "approved", status: "approved", approvedValue: 12500 }),
  });
  assert.equal(memberApproval.status, 403);
  assert.deepEqual(memberApproval.body, { error: "Only customer administrators can approve a change order." });

  const memberRejection = await request(clerkIds.memberA, `${changeOrdersPath}/${memberChangeOrderId}`, {
    method: "PATCH",
    body: JSON.stringify({ approvalStatus: "rejected", status: "rejected" }),
  });
  assert.equal(memberRejection.status, 403);
  assert.deepEqual(memberRejection.body, { error: "Only customer administrators can approve a change order." });

  const memberEdit = await request(clerkIds.memberA, `${changeOrdersPath}/${memberChangeOrderId}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Member edited change", proposedValue: 13000 }),
  });
  assert.equal(memberEdit.status, 200, JSON.stringify(memberEdit.body));
  const memberEditBody = bodyObject(memberEdit.body);
  assert.equal(memberEditBody.title, "Member edited change");
  assert.equal(memberEditBody.proposedValue, 13000);
  assert.equal(memberEditBody.approvalStatus, "pending");
  assert.equal(memberEditBody.status, "under_review");

  const ownerCreated = await createPending(`CO-${runId}-OWNER`, "Owner approval change");
  const ownerApproval = await request(clerkIds.ownerA, `${changeOrdersPath}/${ownerCreated.id}`, {
    method: "PATCH",
    body: JSON.stringify({ approvalStatus: "approved", status: "approved", approvedValue: 12500 }),
  });
  assert.equal(ownerApproval.status, 200, JSON.stringify(ownerApproval.body));
  const ownerApprovalBody = bodyObject(ownerApproval.body);
  assert.equal(ownerApprovalBody.approvalStatus, "approved");
  assert.equal(ownerApprovalBody.status, "approved");
  assert.equal(ownerApprovalBody.approvedValue, 12500);

  const adminCreated = await createPending(`CO-${runId}-ADMIN`, "Admin approval change");
  const adminApproval = await request(clerkIds.adminA, `${changeOrdersPath}/${adminCreated.id}`, {
    method: "PATCH",
    body: JSON.stringify({ approvalStatus: "approved", status: "approved", approvedValue: 12500 }),
  });
  assert.equal(adminApproval.status, 200, JSON.stringify(adminApproval.body));
  const adminApprovalBody = bodyObject(adminApproval.body);
  assert.equal(adminApprovalBody.approvalStatus, "approved");
  assert.equal(adminApprovalBody.status, "approved");
  assert.equal(adminApprovalBody.approvedValue, 12500);

  const platformCreated = await createPending(`CO-${runId}-PLATFORM`, "Platform approval change");
  const platformApproval = await request(clerkIds.platformAdmin, `${changeOrdersPath}/${platformCreated.id}`, {
    method: "PATCH",
    body: JSON.stringify({ approvalStatus: "approved", status: "approved", approvedValue: 12500 }),
  });
  assert.equal(platformApproval.status, 200, JSON.stringify(platformApproval.body));
  const platformApprovalBody = bodyObject(platformApproval.body);
  assert.equal(platformApprovalBody.approvalStatus, "approved");
  assert.equal(platformApprovalBody.status, "approved");
  assert.equal(platformApprovalBody.approvedValue, 12500);

  const rejectionCreated = await createPending(`CO-${runId}-REJECT`, "Admin rejection change");
  const adminRejection = await request(clerkIds.adminA, `${changeOrdersPath}/${rejectionCreated.id}`, {
    method: "PATCH",
    body: JSON.stringify({ approvalStatus: "rejected", status: "rejected" }),
  });
  assert.equal(adminRejection.status, 200, JSON.stringify(adminRejection.body));
  const adminRejectionBody = bodyObject(adminRejection.body);
  assert.equal(adminRejectionBody.approvalStatus, "rejected");
  assert.equal(adminRejectionBody.status, "rejected");

  const crossTenantUpdate = await request(clerkIds.ownerB, `${changeOrdersPath}/${memberChangeOrderId}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Cross-tenant overwrite" }),
  });
  assert.equal(crossTenantUpdate.status, 404);

  const crossEnvironmentUpdate = await request(clerkIds.productionOwnerA, `${changeOrdersPath}/${memberChangeOrderId}`, {
    method: "PATCH",
    body: JSON.stringify({ title: "Cross-environment overwrite" }),
  });
  assert.equal(crossEnvironmentUpdate.status, 404);

  const crossEnvironmentCreate = await request(clerkIds.productionOwnerA, changeOrdersPath, {
    method: "POST",
    body: JSON.stringify(changeOrderBody(`CO-${runId}-PRODUCTION`, "Wrong environment change")),
  });
  assert.equal(crossEnvironmentCreate.status, 404);

  const reloaded = await request(clerkIds.ownerA, `/projects/${projectADtdId}/controls`);
  assert.equal(reloaded.status, 200, JSON.stringify(reloaded.body));
  const changes = bodyObject(reloaded.body).changeOrders as Array<Record<string, unknown>>;
  const persistedMemberChange = changes.find((change) => change.id === memberChangeOrderId);
  assert(persistedMemberChange);
  assert.equal(persistedMemberChange.title, "Member edited change");
  assert.equal(persistedMemberChange.approvalStatus, "pending");
  assert.equal(persistedMemberChange.status, "under_review");
  assert.equal(changes.find((change) => change.id === ownerCreated.id)?.approvalStatus, "approved");
  assert.equal(changes.find((change) => change.id === adminCreated.id)?.approvalStatus, "approved");
  assert.equal(changes.find((change) => change.id === platformCreated.id)?.approvalStatus, "approved");
  assert.equal(changes.find((change) => change.id === rejectionCreated.id)?.approvalStatus, "rejected");

  const persistedRows = await db.select().from(projectChangeOrdersTable).where(and(
    eq(projectChangeOrdersTable.projectId, projectADtdId),
    eq(projectChangeOrdersTable.tenantId, tenantAId),
    eq(projectChangeOrdersTable.environmentId, environmentADtdId),
  ));
  assert.equal(persistedRows.length, 5);
  assert.equal(persistedRows.some((row) => row.title === "Cross-tenant overwrite"), false);
  assert.equal(persistedRows.some((row) => row.title === "Cross-environment overwrite"), false);
});

test("contract validation identifies fields without changing the saved contract", async () => {
  const contractPath = `/projects/${projectADtdId}/controls/contract`;
  const invalidParticipantEmail = await request(clerkIds.ownerA, contractPath, jsonBody({
    contractNumber: `CON-${runId}-INVALID-PARTICIPANT`,
    deliveryMethod: "design_bid_build",
    originalValue: 1,
    currentValue: 1,
    participants: [{
      participantType: "owner",
      organizationName: "Invalid Participant",
      contactEmail: "not-an-email",
    }],
  }));
  assert.equal(invalidParticipantEmail.status, 400, JSON.stringify(invalidParticipantEmail.body));
  const participantError = bodyObject(invalidParticipantEmail.body);
  assert.equal(participantError.code, "VALIDATION_ERROR");
  const participantDetails = participantError.details as Array<Record<string, unknown>>;
  assert(participantDetails.some((detail) =>
    JSON.stringify(detail.path) === JSON.stringify(["participants", 0, "contactEmail"])
    && typeof detail.message === "string"
    && detail.message.toLowerCase().includes("email"),
  ));

  const invalidDocumentUrl = await request(clerkIds.ownerA, contractPath, jsonBody({
    contractNumber: `CON-${runId}-INVALID-DOCUMENT`,
    deliveryMethod: "design_bid_build",
    originalValue: 1,
    currentValue: 1,
    documentUrl: "javascript:invalid",
  }));
  assert.equal(invalidDocumentUrl.status, 400, JSON.stringify(invalidDocumentUrl.body));
  const documentError = bodyObject(invalidDocumentUrl.body);
  assert.equal(documentError.code, "VALIDATION_ERROR");
  const documentDetails = documentError.details as Array<Record<string, unknown>>;
  assert.deepEqual(documentDetails[0]?.path, ["documentUrl"]);
  assert.equal(documentDetails[0]?.message, "Use a valid HTTP or HTTPS URL.");

  const reloaded = await request(clerkIds.ownerA, `/projects/${projectADtdId}/controls`);
  assert.equal(reloaded.status, 200, JSON.stringify(reloaded.body));
  assert.equal(bodyObject(bodyObject(reloaded.body).contract).contractNumber, `CON-${runId}-UPDATED`);
});

test("contract and milestone controls reject cross-tenant and cross-environment access", async () => {
  const controlsPath = `/projects/${projectADtdId}/controls`;
  const contractPath = `/projects/${projectADtdId}/controls/contract`;

  const crossTenantRead = await request(clerkIds.ownerB, controlsPath);
  assert.equal(crossTenantRead.status, 404);
  const crossTenantContractWrite = await request(clerkIds.ownerB, contractPath, jsonBody({
    contractNumber: "CROSS-TENANT",
    deliveryMethod: "design_bid_build",
    originalValue: 1,
    currentValue: 1,
  }));
  assert.equal(crossTenantContractWrite.status, 404);
  const crossTenantMilestoneWrite = await request(clerkIds.ownerB, `/projects/${projectADtdId}/controls/schedule`, {
    method: "POST",
    body: JSON.stringify({ itemNumber: "B-01", name: "Should Not Exist" }),
  });
  assert.equal(crossTenantMilestoneWrite.status, 404);

  const crossEnvironmentRead = await request(clerkIds.productionOwnerA, controlsPath);
  assert.equal(crossEnvironmentRead.status, 404);
  const crossEnvironmentContractWrite = await request(clerkIds.productionOwnerA, contractPath, jsonBody({
    contractNumber: "CROSS-ENVIRONMENT",
    deliveryMethod: "design_bid_build",
    originalValue: 2,
    currentValue: 2,
  }));
  assert.equal(crossEnvironmentContractWrite.status, 404);

  const reloaded = await request(clerkIds.ownerA, controlsPath);
  assert.equal(reloaded.status, 200);
  const controls = bodyObject(reloaded.body);
  const scheduleItems = controls.scheduleItems as Array<Record<string, unknown>>;
  assert.equal(scheduleItems.some((item) => item.name === "Should Not Exist"), false);
  assert.equal(bodyObject(controls.contract).contractNumber, `CON-${runId}-UPDATED`);
});

test("failed participant replacement rolls back the contract and control event", async () => {
  const contractPath = `/projects/${projectADtdId}/controls/contract`;
  const eventsBefore = await db.select().from(projectControlEventsTable).where(and(
    eq(projectControlEventsTable.projectId, projectADtdId),
    eq(projectControlEventsTable.entityType, "contract"),
  ));

  const failedSave = await request(clerkIds.ownerA, contractPath, jsonBody({
    contractNumber: `CON-${runId}-FAILED`,
    deliveryMethod: "design_bid_build",
    originalValue: 999999,
    currentValue: 999999,
    approvalStatus: "rejected",
    participants: [{
      participantType: "owner",
      organizationName: rollbackParticipantMarker,
    }],
  }));
  assert.equal(failedSave.status, 500, JSON.stringify(failedSave.body));

  const reloaded = await request(clerkIds.ownerA, `/projects/${projectADtdId}/controls`);
  assert.equal(reloaded.status, 200, JSON.stringify(reloaded.body));
  const controls = bodyObject(reloaded.body);
  const contract = bodyObject(controls.contract);
  assert.equal(contract.contractNumber, `CON-${runId}-UPDATED`);
  assert.equal(contract.currentValue, 140000);
  const participants = contract.participants as Array<Record<string, unknown>>;
  assert.equal(participants.length, 1);
  assert.equal(participants[0]?.organizationName, "Persistence Builder Updated");

  const eventsAfter = await db.select().from(projectControlEventsTable).where(and(
    eq(projectControlEventsTable.projectId, projectADtdId),
    eq(projectControlEventsTable.entityType, "contract"),
  ));
  assert.equal(eventsAfter.length, eventsBefore.length);
  assert.equal(eventsAfter.some((event) => event.action === "contract_updated" && event.details?.includes("rejected")), false);

  const persistedContract = await db.select().from(projectContractsTable).where(and(
    eq(projectContractsTable.id, contract.id as number),
    eq(projectContractsTable.projectId, projectADtdId),
  ));
  assert.equal(persistedContract[0]?.contractNumber, `CON-${runId}-UPDATED`);
  const persistedParticipants = await db.select().from(contractParticipantsTable).where(eq(
    contractParticipantsTable.contractId,
    contract.id as number,
  ));
  assert.equal(persistedParticipants.length, 1);
  assert.equal(persistedParticipants[0]?.organizationName, "Persistence Builder Updated");
});
