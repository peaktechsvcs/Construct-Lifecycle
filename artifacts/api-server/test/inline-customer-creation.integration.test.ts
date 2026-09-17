import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";

process.env.APP_ENV = "test";

const {
  bidsTable,
  businessCustomersTable,
  db,
  environmentsTable,
  estimatesTable,
  membershipsTable,
  opportunitiesTable,
  pool,
  proposalsTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const { normalizeBusinessCustomerName } = await import("../src/lib/business-customer.ts");
const { default: app } = await import("../src/app.ts");

const runId = `${Date.now()}-${process.pid}`;
const clerkIds = {
  ownerA: `inline-owner-a-${runId}`,
  memberA: `inline-member-a-${runId}`,
  ownerAProduction: `inline-owner-a-production-${runId}`,
  ownerB: `inline-owner-b-${runId}`,
};

let server: Server;
let baseUrl = "";
let tenantAId: number;
let tenantBId: number;
let environmentADtdId: number;
let environmentAProductionId: number;
let environmentBDtdId: number;
let customerADtdId: number;
let otherCustomerADtdId: number;
let customerAProductionId: number;
let customerBDtdId: number;
let linkedOpportunityId: number;
let linkedBidId: number;
let linkedEstimateId: number;

type JsonBody = Record<string, unknown> | unknown[];

async function request(clerkUserId: string, path: string, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-clerk-user-id": clerkUserId,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: JsonBody | string | undefined;
  if (text) {
    try {
      parsed = JSON.parse(text) as JsonBody;
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed };
}

function bodyObject(body: JsonBody | string | undefined) {
  assert.equal(typeof body, "object");
  assert(body !== null);
  assert.equal(Array.isArray(body), false);
  return body as Record<string, unknown>;
}

async function customerByName(
  companyName: string,
  tenantId = tenantAId,
  environmentId = environmentADtdId,
) {
  const normalizedName = normalizeBusinessCustomerName(companyName);
  const [customer] = await db
    .select()
    .from(businessCustomersTable)
    .where(and(
      eq(businessCustomersTable.normalizedName, normalizedName),
      eq(businessCustomersTable.tenantId, tenantId),
      eq(businessCustomersTable.environmentId, environmentId),
    ))
    .limit(1);
  return customer;
}

before(async () => {
  const [tenantA, tenantB] = await db.insert(tenantsTable).values([
    { name: "Inline Customer Tenant A", slug: `inline-customer-a-${runId}` },
    { name: "Inline Customer Tenant B", slug: `inline-customer-b-${runId}` },
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

  const [ownerA, memberA, ownerAProduction, ownerB] = await db.insert(usersTable).values([
    { clerkUserId: clerkIds.ownerA, email: `${clerkIds.ownerA}@integration.test`, displayName: "Inline Owner A" },
    { clerkUserId: clerkIds.memberA, email: `${clerkIds.memberA}@integration.test`, displayName: "Inline Member A" },
    { clerkUserId: clerkIds.ownerAProduction, email: `${clerkIds.ownerAProduction}@integration.test`, displayName: "Inline Production Owner A" },
    { clerkUserId: clerkIds.ownerB, email: `${clerkIds.ownerB}@integration.test`, displayName: "Inline Owner B" },
  ]).returning();

  await db.insert(membershipsTable).values([
    { tenantId: tenantAId, userId: ownerA.id, role: "owner" },
    { tenantId: tenantAId, userId: memberA.id, role: "member" },
    { tenantId: tenantAId, userId: ownerAProduction.id, role: "owner" },
    { tenantId: tenantBId, userId: ownerB.id, role: "owner" },
  ]);
  await db.insert(userTenantContextTable).values([
    { userId: ownerA.id, activeTenantId: tenantAId, activeEnvironmentId: environmentADtdId },
    { userId: memberA.id, activeTenantId: tenantAId, activeEnvironmentId: environmentADtdId },
    { userId: ownerAProduction.id, activeTenantId: tenantAId, activeEnvironmentId: environmentAProductionId },
    { userId: ownerB.id, activeTenantId: tenantBId, activeEnvironmentId: environmentBDtdId },
  ]);

  const [customerA, otherCustomerA, customerAProduction, customerB] = await db.insert(businessCustomersTable).values([
    {
      tenantId: tenantAId,
      environmentId: environmentADtdId,
      companyName: `Existing DTD Customer ${runId}`,
      normalizedName: `existing dtd customer ${runId}`,
    },
    {
      tenantId: tenantAId,
      environmentId: environmentADtdId,
      companyName: `Other Existing DTD Customer ${runId}`,
      normalizedName: `other existing dtd customer ${runId}`,
    },
    {
      tenantId: tenantAId,
      environmentId: environmentAProductionId,
      companyName: `Existing Production Customer ${runId}`,
      normalizedName: `existing production customer ${runId}`,
    },
    {
      tenantId: tenantBId,
      environmentId: environmentBDtdId,
      companyName: `Existing Tenant B Customer ${runId}`,
      normalizedName: `existing tenant b customer ${runId}`,
    },
  ]).returning();
  customerADtdId = customerA.id;
  otherCustomerADtdId = otherCustomerA.id;
  customerAProductionId = customerAProduction.id;
  customerBDtdId = customerB.id;

  const [opportunity] = await db.insert(opportunitiesTable).values({
    tenantId: tenantAId,
    environmentId: environmentADtdId,
    businessCustomerId: customerADtdId,
    opportunityNumber: `INLINE-OP-${runId}`,
    name: `Existing Linked Opportunity ${runId}`,
  }).returning();
  linkedOpportunityId = opportunity.id;

  const [bid] = await db.insert(bidsTable).values({
    tenantId: tenantAId,
    environmentId: environmentADtdId,
    businessCustomerId: customerADtdId,
    opportunityId: linkedOpportunityId,
    bidNumber: `INLINE-BID-${runId}`,
    name: `Existing Linked Bid ${runId}`,
  }).returning();
  linkedBidId = bid.id;

  const [estimate] = await db.insert(estimatesTable).values({
    tenantId: tenantAId,
    environmentId: environmentADtdId,
    businessCustomerId: customerADtdId,
    bidId: linkedBidId,
    estimateNumber: `INLINE-EST-${runId}`,
    name: `Existing Linked Estimate ${runId}`,
  }).returning();
  linkedEstimateId = estimate.id;

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

test("creates inline customers for opportunities, bids, estimates, and proposals in the active environment", async () => {
  const cases = [
    {
      path: "/opportunities",
      companyName: `Inline Opportunity Customer ${runId}`,
      body: { name: `Inline Opportunity ${runId}` },
      table: opportunitiesTable,
      nameColumn: opportunitiesTable.name,
    },
    {
      path: "/bids",
      companyName: `Inline Bid Customer ${runId}`,
      body: { name: `Inline Bid ${runId}` },
      table: bidsTable,
      nameColumn: bidsTable.name,
    },
    {
      path: "/estimates",
      companyName: `Inline Estimate Customer ${runId}`,
      body: { name: `Inline Estimate ${runId}` },
      table: estimatesTable,
      nameColumn: estimatesTable.name,
    },
    {
      path: "/proposals",
      companyName: `Inline Proposal Customer ${runId}`,
      body: { name: `Inline Proposal ${runId}` },
      table: proposalsTable,
      nameColumn: proposalsTable.name,
    },
  ] as const;

  for (const item of cases) {
    const created = await request(clerkIds.ownerA, item.path, {
      newCustomer: { companyName: item.companyName, customerType: "general-contractor" },
      ...item.body,
    });
    assert.equal(created.status, 201, `${item.path}: ${JSON.stringify(created.body)}`);
    const response = bodyObject(created.body);
    const customer = await customerByName(item.companyName);
    assert(customer);
    assert.equal(response.businessCustomerId, customer.id);
    assert.equal(response.environmentId, environmentADtdId);

    const [record] = await db
      .select({
        tenantId: item.table.tenantId,
        environmentId: item.table.environmentId,
        businessCustomerId: item.table.businessCustomerId,
      })
      .from(item.table)
      .where(eq(item.nameColumn, item.body.name))
      .limit(1);
    assert(record);
    assert.equal(record.tenantId, tenantAId);
    assert.equal(record.environmentId, environmentADtdId);
    assert.equal(record.businessCustomerId, customer.id);
  }
});

test("resolves concurrent inline customer creation to one scoped customer", async () => {
  const companyName = `Concurrent Inline Customer ${runId}`;
  const [first, second] = await Promise.all([
    request(clerkIds.ownerA, "/opportunities", {
      newCustomer: { companyName },
      name: `Concurrent Opportunity One ${runId}`,
    }),
    request(clerkIds.ownerA, "/opportunities", {
      newCustomer: { companyName: `  ${companyName.toUpperCase()}  ` },
      name: `Concurrent Opportunity Two ${runId}`,
    }),
  ]);

  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const firstBody = bodyObject(first.body);
  const secondBody = bodyObject(second.body);
  assert.equal(firstBody.businessCustomerId, secondBody.businessCustomerId);

  const dtdCustomer = await customerByName(companyName, tenantAId, environmentADtdId);
  assert(dtdCustomer);
  assert.equal(firstBody.businessCustomerId, dtdCustomer.id);
  const dtdCustomers = await db
    .select({ id: businessCustomersTable.id })
    .from(businessCustomersTable)
    .where(and(
      eq(businessCustomersTable.tenantId, tenantAId),
      eq(businessCustomersTable.environmentId, environmentADtdId),
      eq(businessCustomersTable.normalizedName, normalizeBusinessCustomerName(companyName)),
    ));
  assert.equal(dtdCustomers.length, 1);

  const [production, otherTenant] = await Promise.all([
    request(clerkIds.ownerAProduction, "/opportunities", {
      newCustomer: { companyName },
      name: `Concurrent Production Opportunity ${runId}`,
    }),
    request(clerkIds.ownerB, "/opportunities", {
      newCustomer: { companyName },
      name: `Concurrent Other Tenant Opportunity ${runId}`,
    }),
  ]);
  assert.equal(production.status, 201, JSON.stringify(production.body));
  assert.equal(otherTenant.status, 201, JSON.stringify(otherTenant.body));
  const productionBody = bodyObject(production.body);
  const otherTenantBody = bodyObject(otherTenant.body);
  assert.notEqual(productionBody.businessCustomerId, dtdCustomer.id);
  assert.notEqual(otherTenantBody.businessCustomerId, dtdCustomer.id);
  assert.notEqual(productionBody.businessCustomerId, otherTenantBody.businessCustomerId);
  assert(await customerByName(companyName, tenantAId, environmentAProductionId));
  assert(await customerByName(companyName, tenantBId, environmentBDtdId));
});

test("members cannot create inline customers", async () => {
  const cases = [
    ["/opportunities", { name: `Member Opportunity ${runId}` }],
    ["/bids", { name: `Member Bid ${runId}` }],
    ["/estimates", { name: `Member Estimate ${runId}` }],
    ["/proposals", { name: `Member Proposal ${runId}` }],
  ] as const;

  for (const [path, record] of cases) {
    const companyName = `Member Inline Customer ${path.slice(1)} ${runId}`;
    const result = await request(clerkIds.memberA, path, {
      newCustomer: { companyName },
      ...record,
    });
    assert.equal(result.status, 403, `${path}: ${JSON.stringify(result.body)}`);
    assert.equal(await customerByName(companyName), undefined);
  }
});

test("rejects new customers linked to existing pipeline records without creating orphans", async () => {
  const cases = [
    {
      path: "/bids",
      companyName: `Rejected Bid Customer ${runId}`,
      body: { opportunityId: linkedOpportunityId, name: `Rejected Bid ${runId}` },
    },
    {
      path: "/estimates",
      companyName: `Rejected Estimate Customer ${runId}`,
      body: { bidId: linkedBidId, name: `Rejected Estimate ${runId}` },
    },
    {
      path: "/proposals",
      companyName: `Rejected Proposal Customer ${runId}`,
      body: { estimateId: linkedEstimateId, name: `Rejected Proposal ${runId}` },
    },
  ] as const;

  for (const item of cases) {
    const result = await request(clerkIds.ownerA, item.path, {
      newCustomer: { companyName: item.companyName },
      ...item.body,
    });
    assert.equal(result.status, 400, `${item.path}: ${JSON.stringify(result.body)}`);
    assert.match(String(bodyObject(result.body).error), /new customer cannot be linked/i);
    assert.equal(await customerByName(item.companyName), undefined);
  }
});

test("keeps existing pipeline links scoped to their selected customer", async () => {
  const cases = [
    {
      path: "/bids",
      body: {
        businessCustomerId: otherCustomerADtdId,
        opportunityId: linkedOpportunityId,
        name: `Mismatched Bid ${runId}`,
      },
      message: /bid opportunity must belong/i,
    },
    {
      path: "/estimates",
      body: {
        businessCustomerId: otherCustomerADtdId,
        bidId: linkedBidId,
        name: `Mismatched Estimate ${runId}`,
      },
      message: /estimate bid must belong/i,
    },
    {
      path: "/proposals",
      body: {
        businessCustomerId: otherCustomerADtdId,
        estimateId: linkedEstimateId,
        name: `Mismatched Proposal ${runId}`,
      },
      message: /proposal estimate must belong/i,
    },
  ] as const;

  for (const item of cases) {
    const result = await request(clerkIds.ownerA, item.path, item.body);
    assert.equal(result.status, 400, `${item.path}: ${JSON.stringify(result.body)}`);
    assert.match(String(bodyObject(result.body).error), item.message);
  }
});

test("rejects existing customers from another tenant or environment", async () => {
  const cases = [
    { path: "/opportunities", customerId: customerAProductionId, clerkUserId: clerkIds.ownerA, name: `Foreign Environment Opportunity ${runId}` },
    { path: "/bids", customerId: customerAProductionId, clerkUserId: clerkIds.ownerA, name: `Foreign Environment Bid ${runId}` },
    { path: "/estimates", customerId: customerAProductionId, clerkUserId: clerkIds.ownerA, name: `Foreign Environment Estimate ${runId}` },
    { path: "/proposals", customerId: customerAProductionId, clerkUserId: clerkIds.ownerA, name: `Foreign Environment Proposal ${runId}` },
    { path: "/opportunities", customerId: customerADtdId, clerkUserId: clerkIds.ownerAProduction, name: `Foreign Production Opportunity ${runId}` },
    { path: "/bids", customerId: customerADtdId, clerkUserId: clerkIds.ownerAProduction, name: `Foreign Production Bid ${runId}` },
    { path: "/estimates", customerId: customerADtdId, clerkUserId: clerkIds.ownerAProduction, name: `Foreign Production Estimate ${runId}` },
    { path: "/proposals", customerId: customerADtdId, clerkUserId: clerkIds.ownerAProduction, name: `Foreign Production Proposal ${runId}` },
    { path: "/opportunities", customerId: customerBDtdId, clerkUserId: clerkIds.ownerA, name: `Foreign Tenant Opportunity ${runId}` },
    { path: "/bids", customerId: customerBDtdId, clerkUserId: clerkIds.ownerA, name: `Foreign Tenant Bid ${runId}` },
    { path: "/estimates", customerId: customerBDtdId, clerkUserId: clerkIds.ownerA, name: `Foreign Tenant Estimate ${runId}` },
    { path: "/proposals", customerId: customerBDtdId, clerkUserId: clerkIds.ownerA, name: `Foreign Tenant Proposal ${runId}` },
  ] as const;

  for (const item of cases) {
    const result = await request(item.clerkUserId, item.path, {
      businessCustomerId: item.customerId,
      name: item.name,
    });
    assert.equal(result.status, 404, `${item.path}: ${JSON.stringify(result.body)}`);
    assert.match(String(bodyObject(result.body).error), /active business customer/i);
  }
});