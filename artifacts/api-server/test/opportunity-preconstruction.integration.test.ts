import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import {
  bidScopesTable,
  bidsTable,
  businessCustomersTable,
  db,
  environmentsTable,
  estimatesTable,
  membershipsTable,
  opportunitiesTable,
  opportunityActivitiesTable,
  pool,
  proposalsTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} from "@workspace/db";
import app from "../src/app.ts";

const runId = `${Date.now()}-${process.pid}`;
const clerkUserId = `preconstruction-${runId}`;
const otherClerkUserId = `preconstruction-other-${runId}`;
const tenantSlug = `preconstruction-${runId}`;

let server: Server;
let baseUrl = "";
let tenantId: number;
let environmentId: number;
let otherEnvironmentId: number;
let opportunityId: number;

async function request(path: string, clerkId = clerkUserId, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-clerk-user-id": clerkId,
      ...init.headers,
    },
  });
  const body = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : await response.text();
  return { response, body };
}

before(async () => {
  const [tenant] = await db.insert(tenantsTable).values({ name: "Preconstruction", slug: tenantSlug }).returning();
  tenantId = tenant.id;
  const [environment] = await db.insert(environmentsTable).values({
    tenantId, name: "Development / Test / Demo", slug: "dtd", kind: "dtd", status: "active",
  }).returning();
  environmentId = environment.id;
  const [otherEnvironment] = await db.insert(environmentsTable).values({
    tenantId, name: "Production", slug: "production", kind: "production", status: "active",
  }).returning();
  otherEnvironmentId = otherEnvironment.id;

  const [user] = await db.insert(usersTable).values({
    clerkUserId, email: `${clerkUserId}@integration.test`, displayName: "Preconstruction Owner",
  }).returning();
  const [otherUser] = await db.insert(usersTable).values({
    clerkUserId: otherClerkUserId, email: `${otherClerkUserId}@integration.test`, displayName: "Production Owner",
  }).returning();
  await db.insert(membershipsTable).values([
    { tenantId, userId: user.id, role: "owner" },
    { tenantId, userId: otherUser.id, role: "owner" },
  ]);
  await db.insert(userTenantContextTable).values([
    { userId: user.id, activeTenantId: tenantId, activeEnvironmentId: environmentId },
    { userId: otherUser.id, activeTenantId: tenantId, activeEnvironmentId: otherEnvironmentId },
  ]);

  const [customer] = await db.insert(businessCustomersTable).values({
    tenantId, environmentId, companyName: "Preconstruction Owner", normalizedName: `preconstruction-owner-${runId}`,
  }).returning();
  const [opportunity] = await db.insert(opportunitiesTable).values({
    tenantId, environmentId, businessCustomerId: customer.id, opportunityNumber: `OP-PRE-${runId}`,
    name: "North Campus Expansion", estimatedValue: "275000", contactName: "Alex Owner",
  }).returning();
  opportunityId = opportunity.id;
  const [bid] = await db.insert(bidsTable).values({
    tenantId, environmentId, businessCustomerId: customer.id, opportunityId,
    bidNumber: `BID-PRE-${runId}`, name: "North Campus Bid", estimatedValue: "275000",
  }).returning();
  await db.insert(bidScopesTable).values({
    tenantId, environmentId, bidId: bid.id, name: "Millwork", amount: "150000",
  });
  const [estimate] = await db.insert(estimatesTable).values({
    tenantId, environmentId, businessCustomerId: customer.id, bidId: bid.id,
    estimateNumber: `EST-PRE-${runId}`, name: "North Campus Estimate", totalValue: "262500",
  }).returning();
  await db.insert(proposalsTable).values({
    tenantId, environmentId, businessCustomerId: customer.id, bidId: bid.id, estimateId: estimate.id,
    proposalNumber: `PROP-PRE-${runId}`, name: "North Campus Proposal", proposalValue: "280000",
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
  if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  await pool.end();
});

test("returns one linked preconstruction graph and records scoped contact activity", async () => {
  const graph = await request(`/opportunities/${opportunityId}/preconstruction`);
  assert.equal(graph.response.status, 200, JSON.stringify(graph.body));
  assert.equal(graph.body.opportunity.id, opportunityId);
  assert.deepEqual(graph.body.nodes.map((node: { recordType: string }) => node.recordType), ["bid", "estimate", "proposal"]);
  assert.equal(graph.body.summary.bidCount, 1);
  assert.equal(graph.body.summary.scopeCount, 1);
  assert.equal(graph.body.summary.estimateCount, 1);
  assert.equal(graph.body.summary.proposalCount, 1);
  assert.equal(graph.body.summary.coverageGapCount, 1);

  const created = await request(`/opportunities/${opportunityId}/activity`, clerkUserId, {
    method: "POST",
    body: JSON.stringify({
      activityType: "call",
      subject: "Confirm scope with owner",
      body: "Owner confirmed the millwork scope is still in review.",
      nextActionDate: "2026-10-05",
    }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.nextActionDate, "2026-10-05");
  assert.equal(created.body.completed, false);

  const listed = await request(`/opportunities/${opportunityId}/activity`);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.length, 1);
  const completed = await request(`/opportunities/${opportunityId}/activity/${created.body.id}`, clerkUserId, {
    method: "PATCH",
    body: JSON.stringify({ completed: true }),
  });
  assert.equal(completed.response.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.completed, true);

  const updatedOpportunity = await db.select().from(opportunitiesTable).where(and(
    eq(opportunitiesTable.id, opportunityId),
    eq(opportunitiesTable.tenantId, tenantId),
    eq(opportunitiesTable.environmentId, environmentId),
  ));
  assert.equal(updatedOpportunity[0].nextAction, "Confirm scope with owner");
  assert.equal(updatedOpportunity[0].nextActionDate, "2026-10-05");
});

test("does not expose activity or graph records across environments", async () => {
  const foreignGraph = await request(`/opportunities/${opportunityId}/preconstruction`, otherClerkUserId);
  assert.equal(foreignGraph.response.status, 404);
  const foreignActivity = await request(`/opportunities/${opportunityId}/activity`, otherClerkUserId);
  assert.equal(foreignActivity.response.status, 404);
  assert.equal((await db.select().from(opportunityActivitiesTable).where(eq(opportunityActivitiesTable.environmentId, otherEnvironmentId))).length, 0);
});