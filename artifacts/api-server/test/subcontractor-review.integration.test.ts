import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";

process.env.APP_ENV = "test";

const {
  db,
  environmentsTable,
  membershipsTable,
  pool,
  projectsTable,
  subcontractAgreementsTable,
  subcontractAuditEventsTable,
  subcontractChangeOrdersTable,
  subcontractCloseoutItemsTable,
  subcontractPayApplicationsTable,
  subcontractWaiversTable,
  tenantsTable,
  tradePartnersTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const { default: app } = await import("../src/app.ts");

const runId = `${Date.now()}-${process.pid}`;
const ownerClerkId = `subcontract-review-owner-${runId}`;
const memberClerkId = `subcontract-review-member-${runId}`;

let server: Server;
let baseUrl = "";
let tenantId: number;
let environmentId: number;
let agreementId: number;
let changeOrderId: number;
let payApplicationId: number;
let waiverId: number;
let closeoutItemId: number;

async function request(clerkUserId: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-clerk-user-id": clerkUserId,
      ...init.headers,
    },
  });
  const body = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
  return { status: response.status, body: body as Record<string, unknown> | null };
}

before(async () => {
  const [tenant] = await db.insert(tenantsTable).values({ name: "Subcontract Review", slug: `subcontract-review-${runId}` }).returning();
  tenantId = tenant.id;
  const [environment] = await db.insert(environmentsTable).values({
    tenantId,
    name: "Development / Test / Demo",
    slug: "dtd",
    kind: "dtd",
    status: "active",
  }).returning();
  environmentId = environment.id;

  const [owner, member] = await db.insert(usersTable).values([
    { clerkUserId: ownerClerkId, email: `${ownerClerkId}@integration.test`, displayName: "Subcontract Owner" },
    { clerkUserId: memberClerkId, email: `${memberClerkId}@integration.test`, displayName: "Subcontract Member" },
  ]).returning();
  await db.insert(membershipsTable).values([
    { tenantId, userId: owner.id, role: "owner" },
    { tenantId, userId: member.id, role: "member" },
  ]);
  await db.insert(userTenantContextTable).values([
    { userId: owner.id, activeTenantId: tenantId, activeEnvironmentId: environmentId },
    { userId: member.id, activeTenantId: tenantId, activeEnvironmentId: environmentId },
  ]);

  const [project] = await db.insert(projectsTable).values({
    projectNumber: `SUB-${runId}`,
    customerName: "Review Test Customer",
    projectName: "Review Evidence",
    category: "commercial",
    tenantId,
    environmentId,
  }).returning();
  const [partner] = await db.insert(tradePartnersTable).values({
    companyName: "Review Test Trade Partner",
    normalizedName: `review test trade partner ${runId}`,
    qualificationStatus: "approved",
    tenantId,
    environmentId,
  }).returning();
  const [agreement] = await db.insert(subcontractAgreementsTable).values({
    projectId: project.id,
    tradePartnerId: partner.id,
    agreementNumber: `AGR-${runId}`,
    scope: "Concrete work",
    originalValue: "1000",
    currentValue: "1000",
    tenantId,
    environmentId,
  }).returning();
  agreementId = agreement.id;
  const [changeOrder] = await db.insert(subcontractChangeOrdersTable).values({
    agreementId,
    changeNumber: "CO-001",
    title: "Additional footing",
    proposedValue: "250",
    tenantId,
    environmentId,
  }).returning();
  changeOrderId = changeOrder.id;
  const [payApplication] = await db.insert(subcontractPayApplicationsTable).values({
    agreementId,
    applicationNumber: "PAY-001",
    grossAmount: "500",
    retainageAmount: "50",
    netAmount: "450",
    status: "submitted",
    waiverStatus: "conditional",
    tenantId,
    environmentId,
  }).returning();
  payApplicationId = payApplication.id;
  const [waiver] = await db.insert(subcontractWaiversTable).values({
    payApplicationId,
    waiverType: "conditional",
    status: "submitted",
    tenantId,
    environmentId,
  }).returning();
  waiverId = waiver.id;
  const [closeoutItem] = await db.insert(subcontractCloseoutItemsTable).values({
    agreementId,
    itemType: "warranty",
    title: "Warranty package",
    status: "submitted",
    tenantId,
    environmentId,
  }).returning();
  closeoutItemId = closeoutItem.id;

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
  await pool.end();
});

test("only owner/admin can review, and approved changes recalculate agreement value", async () => {
  const memberAttempt = await request(memberClerkId, `/subcontract-change-orders/${changeOrderId}/review`, {
    method: "POST",
    body: JSON.stringify({ decision: "approved" }),
  });
  assert.equal(memberAttempt.status, 403);

  const missingReason = await request(ownerClerkId, `/subcontract-change-orders/${changeOrderId}/review`, {
    method: "POST",
    body: JSON.stringify({ decision: "rejected" }),
  });
  assert.equal(missingReason.status, 400);

  const approved = await request(ownerClerkId, `/subcontract-change-orders/${changeOrderId}/review`, {
    method: "POST",
    body: JSON.stringify({ decision: "approved" }),
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));

  const [agreement] = await db.select().from(subcontractAgreementsTable).where(eq(subcontractAgreementsTable.id, agreementId));
  const [changeOrder] = await db.select().from(subcontractChangeOrdersTable).where(eq(subcontractChangeOrdersTable.id, changeOrderId));
  const [audit] = await db.select().from(subcontractAuditEventsTable).where(and(
    eq(subcontractAuditEventsTable.entityType, "subcontract_change_order"),
    eq(subcontractAuditEventsTable.entityId, changeOrderId),
    eq(subcontractAuditEventsTable.action, "subcontract_change_order_approved"),
  ));
  assert.equal(agreement.currentValue, "1250.00");
  assert.equal(changeOrder.approvalStatus, "approved");
  assert.equal(changeOrder.approvedValue, "250.00");
  assert.equal(audit.toStatus, "approved");
});

test("rejections require reasons and waiver rejection resets pay application waiver state", async () => {
  const rejectedPay = await request(ownerClerkId, `/subcontract-pay-applications/${payApplicationId}/review`, {
    method: "POST",
    body: JSON.stringify({ decision: "rejected", reason: "Backup is incomplete" }),
  });
  assert.equal(rejectedPay.status, 200, JSON.stringify(rejectedPay.body));

  const rejectedWaiver = await request(ownerClerkId, `/subcontract-waivers/${waiverId}/review`, {
    method: "POST",
    body: JSON.stringify({ decision: "rejected", reason: "Signed waiver is missing" }),
  });
  assert.equal(rejectedWaiver.status, 200, JSON.stringify(rejectedWaiver.body));

  const rejectedCloseout = await request(ownerClerkId, `/subcontract-closeout-items/${closeoutItemId}/review`, {
    method: "POST",
    body: JSON.stringify({ decision: "rejected", reason: "Warranty document is incomplete" }),
  });
  assert.equal(rejectedCloseout.status, 200, JSON.stringify(rejectedCloseout.body));

  const detail = await request(ownerClerkId, `/subcontract-agreements/${agreementId}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  const body = detail.body as {
    payApplications: Array<{ id: number; status: string; rejectionReason: string | null; waiverStatus: string }>;
    waivers: Array<{ id: number; status: string; reviewedByUserId: number | null }>;
    closeoutItems: Array<{ id: number; status: string; rejectionReason: string | null }>;
  };
  assert.equal(body.payApplications.find((item) => item.id === payApplicationId)?.status, "rejected");
  assert.equal(body.payApplications.find((item) => item.id === payApplicationId)?.rejectionReason, "Backup is incomplete");
  assert.equal(body.payApplications.find((item) => item.id === payApplicationId)?.waiverStatus, "missing");
  assert.equal(body.waivers.find((item) => item.id === waiverId)?.status, "rejected");
  assert.equal(body.waivers.find((item) => item.id === waiverId)?.reviewedByUserId != null, true);
  assert.equal(body.closeoutItems.find((item) => item.id === closeoutItemId)?.rejectionReason, "Warranty document is incomplete");
});