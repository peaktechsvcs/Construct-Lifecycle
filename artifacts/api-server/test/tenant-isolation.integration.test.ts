import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";

process.env.APP_ENV = "test";

const {
  activityTable,
  bidScopesTable,
  bidsTable,
  businessCustomersTable,
  db,
  environmentsTable,
  followUpsTable,
  membershipsTable,
  pool,
  projectsTable,
  tenantBrandingVersionsTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const { default: app } = await import("../src/app.ts");

type Json = Record<string, unknown> | unknown[];

const runId = `${Date.now()}-${process.pid}`;
const clerkIds = {
  ownerA: `isolation-owner-a-${runId}`,
  adminA: `isolation-admin-a-${runId}`,
  memberA: `isolation-member-a-${runId}`,
  viewerA: `isolation-viewer-a-${runId}`,
  ownerB: `isolation-owner-b-${runId}`,
  switcher: `isolation-switcher-${runId}`,
};

let server: Server;
let baseUrl = "";
let tenantAId: number;
let tenantBId: number;
let environmentAId: number;
let environmentBId: number;
let projectAId: number;
let projectBId: number;
let followUpBId: number;
let bidAId: number;
let bidBId: number;

async function request(
  clerkUserId: string,
  path: string,
  init: RequestInit = {},
) {
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

const serialized = (value: unknown) => JSON.stringify(value);

before(async () => {
  const [tenantA, tenantB] = await db.insert(tenantsTable).values([
    { name: "Isolation Tenant A", slug: `isolation-a-${runId}` },
    { name: "Isolation Tenant B", slug: `isolation-b-${runId}` },
  ]).returning();
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  const [environmentA, environmentB] = await db.insert(environmentsTable).values([
    { tenantId: tenantAId, name: "Test", slug: "test", kind: "dtd" },
    { tenantId: tenantBId, name: "Test", slug: "test", kind: "dtd" },
  ]).returning();
  environmentAId = environmentA.id;
  environmentBId = environmentB.id;

  const users = await db.insert(usersTable).values(
    Object.entries(clerkIds).map(([name, clerkUserId]) => ({
      clerkUserId,
      email: `${name}-${runId}@integration.test`,
      displayName: name,
    })),
  ).returning();
  const userId = Object.fromEntries(users.map((user) => [user.clerkUserId, user.id]));

  await db.insert(membershipsTable).values([
    { tenantId: tenantAId, userId: userId[clerkIds.ownerA], role: "owner" },
    { tenantId: tenantAId, userId: userId[clerkIds.adminA], role: "admin" },
    { tenantId: tenantAId, userId: userId[clerkIds.memberA], role: "member" },
    { tenantId: tenantAId, userId: userId[clerkIds.viewerA], role: "viewer" },
    { tenantId: tenantBId, userId: userId[clerkIds.ownerB], role: "owner" },
    { tenantId: tenantAId, userId: userId[clerkIds.switcher], role: "member" },
    { tenantId: tenantBId, userId: userId[clerkIds.switcher], role: "member" },
  ]);
  await db.insert(userTenantContextTable).values(
    users.map((user) => {
      const startsInB = user.clerkUserId === clerkIds.ownerB;
      return {
        userId: user.id,
        activeTenantId: startsInB ? tenantBId : tenantAId,
        activeEnvironmentId: startsInB ? environmentBId : environmentAId,
      };
    }),
  );

  const [projectA, projectB] = await db.insert(projectsTable).values([
    {
      tenantId: tenantAId, environmentId: environmentAId,
      projectNumber: `A-${runId}`, customerName: "Customer A",
      projectName: `Visible A ${runId}`, category: "commercial",
      stage: "opportunity", contractValue: "111.00",
    },
    {
      tenantId: tenantBId, environmentId: environmentBId,
      projectNumber: `B-${runId}`, customerName: "Customer B",
      projectName: `Secret B ${runId}`, category: "commercial",
      stage: "opportunity", contractValue: "999999.00",
    },
  ]).returning();
  projectAId = projectA.id;
  projectBId = projectB.id;

  const [customerA, customerB] = await db.insert(businessCustomersTable).values([
    {
      tenantId: tenantAId, environmentId: environmentAId,
      companyName: `Bid Customer A ${runId}`, normalizedName: `bid-customer-a-${runId}`,
    },
    {
      tenantId: tenantBId, environmentId: environmentBId,
      companyName: `Bid Customer B ${runId}`, normalizedName: `bid-customer-b-${runId}`,
    },
  ]).returning();
  const [bidA, bidB] = await db.insert(bidsTable).values([
    {
      tenantId: tenantAId, environmentId: environmentAId, businessCustomerId: customerA.id,
      bidNumber: `BID-A-${runId}`, name: `Scoped Bid A ${runId}`, bidType: "specialty",
      specialty: "Electrical", estimatedValue: "100.00",
    },
    {
      tenantId: tenantBId, environmentId: environmentBId, businessCustomerId: customerB.id,
      bidNumber: `BID-B-${runId}`, name: `Secret Bid B ${runId}`, bidType: "specialty",
      specialty: "HVAC", estimatedValue: "900.00",
    },
  ]).returning();
  bidAId = bidA.id;
  bidBId = bidB.id;
  await db.insert(bidScopesTable).values([
    {
      tenantId: tenantAId, environmentId: environmentAId, bidId: bidAId,
      name: "Electrical package", amount: "125.00", ownerUserId: userId[clerkIds.ownerA],
      status: "active", takeoffCoverage: "full", estimatingCoverage: "partial",
      estimatingProvider: "Estimator A",
    },
    {
      tenantId: tenantBId, environmentId: environmentBId, bidId: bidBId,
      name: "Secret HVAC package", amount: "999.00", ownerUserId: userId[clerkIds.ownerB],
      status: "draft",
    },
  ]);

  await db.insert(activityTable).values([
    { tenantId: tenantAId, environmentId: environmentAId, projectId: projectAId, action: "A action", description: `Visible activity A ${runId}` },
    { tenantId: tenantBId, environmentId: environmentBId, projectId: projectBId, action: "B action", description: `Secret activity B ${runId}` },
  ]);
  const [, followUpB] = await db.insert(followUpsTable).values([
    { tenantId: tenantAId, environmentId: environmentAId, projectId: projectAId, dueDate: "2026-09-14", note: `Visible follow-up A ${runId}` },
    { tenantId: tenantBId, environmentId: environmentBId, projectId: projectBId, dueDate: "2026-09-14", note: `Secret follow-up B ${runId}` },
  ]).returning();
  followUpBId = followUpB.id;

  await db.insert(tenantBrandingVersionsTable).values([
    { tenantId: tenantAId, environmentId: environmentAId, version: 1, data: JSON.stringify({ primaryColor: "#111111", marker: `branding-a-${runId}` }) },
    { tenantId: tenantBId, environmentId: environmentBId, version: 1, data: JSON.stringify({ primaryColor: "#999999", marker: `branding-b-${runId}` }) },
  ]);

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

describe("tenant isolation integration", () => {
  test("project, search, activity, follow-up, dashboard, and branding reads exclude foreign data", async () => {
    const paths = [
      "/projects",
      `/projects?search=${encodeURIComponent(`Secret B ${runId}`)}`,
      "/follow-ups",
      "/dashboard/summary",
      "/dashboard/activity",
      "/dashboard/drilldown?type=open-follow-ups",
      "/tenant/branding/published",
    ];
    for (const path of paths) {
      const result = await request(clerkIds.ownerA, path);
      assert.equal(result.status, 200, path);
      assert.doesNotMatch(serialized(result.body), new RegExp(`Secret|branding-b-${runId}|999999`), path);
    }

    for (const path of [`/projects/${projectBId}`, `/projects/${projectBId}/activity`]) {
      const result = await request(clerkIds.ownerA, path);
      assert.equal(result.status, 404, path);
    }

    const reverse = await request(clerkIds.ownerB, "/projects");
    assert.equal(reverse.status, 200);
    assert.doesNotMatch(serialized(reverse.body), new RegExp(`Visible A ${runId}`));
  });

  test("foreign project and follow-up IDs cannot be changed or deleted", async () => {
    const patchProject = await request(clerkIds.ownerA, `/projects/${projectBId}`, {
      method: "PATCH",
      body: JSON.stringify({ projectName: "Compromised", category: "commercial" }),
    });
    assert.equal(patchProject.status, 404);

    const deleteProject = await request(clerkIds.ownerA, `/projects/${projectBId}`, { method: "DELETE" });
    assert.equal(deleteProject.status, 404);

    const patchFollowUp = await request(clerkIds.ownerA, `/follow-ups/${followUpBId}`, {
      method: "PATCH",
      body: JSON.stringify({ note: "Compromised" }),
    });
    assert.equal(patchFollowUp.status, 404);

    const [projectB] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectBId));
    const [followUpB] = await db.select().from(followUpsTable).where(eq(followUpsTable.id, followUpBId));
    assert.equal(projectB.projectName, `Secret B ${runId}`);
    assert.equal(followUpB.note, `Secret follow-up B ${runId}`);
  });

  test("viewers cannot mutate business records or branding", async () => {
    const mutations: Array<[string, RequestInit]> = [
      ["/projects", { method: "POST", body: JSON.stringify({ projectName: "Denied", category: "commercial" }) }],
      [`/projects/${projectAId}`, { method: "PATCH", body: JSON.stringify({ projectName: "Denied", category: "commercial" }) }],
      [`/projects/${projectAId}`, { method: "DELETE" }],
      ["/follow-ups", { method: "POST", body: JSON.stringify({ projectId: projectAId, dueDate: "2026-09-15", note: "Denied" }) }],
      ["/tenant/branding", { method: "PUT", body: JSON.stringify({ primaryColor: "#123456" }) }],
    ];
    for (const [path, init] of mutations) {
      const result = await request(clerkIds.viewerA, path, init);
      assert.equal(result.status, 403, `${init.method} ${path}`);
    }
  });

  test("only owners and admins can change branding", async () => {
    for (const clerkUserId of [clerkIds.memberA, clerkIds.viewerA]) {
      const denied = await request(clerkUserId, "/tenant/branding", {
        method: "PUT",
        body: JSON.stringify({ primaryColor: "#123456" }),
      });
      assert.equal(denied.status, 403);
    }
    for (const clerkUserId of [clerkIds.ownerA, clerkIds.adminA]) {
      const allowed = await request(clerkUserId, "/tenant/branding", {
        method: "PUT",
        body: JSON.stringify({ primaryColor: "#123456" }),
      });
      assert.equal(allowed.status, 200);
    }
  });

  test("active tenant switching accepts only authorized memberships", async () => {
    const denied = await request(clerkIds.ownerA, "/tenant/context", {
      method: "POST",
      body: JSON.stringify({ tenantId: tenantBId }),
    });
    assert.equal(denied.status, 403);
    const stillA = await request(clerkIds.ownerA, "/projects");
    assert.match(serialized(stillA.body), new RegExp(`Visible A ${runId}`));
    assert.doesNotMatch(serialized(stillA.body), new RegExp(`Secret B ${runId}`));

    const allowed = await request(clerkIds.switcher, "/tenant/context", {
      method: "POST",
      body: JSON.stringify({ tenantId: tenantBId }),
    });
    assert.equal(allowed.status, 200);
    const nowB = await request(clerkIds.switcher, "/projects");
    assert.match(serialized(nowB.body), new RegExp(`Secret B ${runId}`));
    assert.doesNotMatch(serialized(nowB.body), new RegExp(`Visible A ${runId}`));
  });

  test("specialty scopes roll up and cannot cross tenant boundaries", async () => {
    const listA = await request(clerkIds.ownerA, "/bids");
    assert.equal(listA.status, 200);
    assert.match(serialized(listA.body), new RegExp(`Scoped Bid A ${runId}`));
    assert.doesNotMatch(serialized(listA.body), new RegExp(`Secret Bid B ${runId}|Secret HVAC`));
    const scopedBid = (listA.body as Array<Record<string, unknown>>).find((bid) => bid.id === bidAId);
    assert.equal(scopedBid?.scopeCount, 1);
    assert.equal(scopedBid?.scopeTotal, 125);
    assert.equal(scopedBid?.coverageGapCount, 1);
    assert.equal(scopedBid?.hasCoverageGap, true);

    const scopesA = await request(clerkIds.ownerA, `/bids/${bidAId}/scopes`);
    assert.equal(scopesA.status, 200);
    assert.equal((scopesA.body as Array<unknown>).length, 1);
    const foreignBid = await request(clerkIds.ownerA, `/bids/${bidBId}`);
    assert.equal(foreignBid.status, 404);
    const foreignScopes = await request(clerkIds.ownerA, `/bids/${bidBId}/scopes`);
    assert.equal(foreignScopes.status, 404);
    const deniedCreate = await request(clerkIds.ownerA, `/bids/${bidBId}/scopes`, {
      method: "POST",
      body: JSON.stringify({ name: "Should not cross", amount: 10 }),
    });
    assert.equal(deniedCreate.status, 404);

    const created = await request(clerkIds.ownerA, `/bids/${bidAId}/scopes`, {
      method: "POST",
      body: JSON.stringify({
        name: "Controls package", amount: 75, status: "active",
        takeoffProvider: "Takeoff A", takeoffCoverage: "full",
        estimatingProvider: "Estimator A", estimatingCoverage: "full",
      }),
    });
    assert.equal(created.status, 201);
    const updated = await request(clerkIds.ownerA, `/bids/${bidAId}`);
    assert.equal(updated.status, 200);
    assert.equal((updated.body as Record<string, unknown>).scopeCount, 2);
    assert.equal((updated.body as Record<string, unknown>).scopeTotal, 200);
  });
});