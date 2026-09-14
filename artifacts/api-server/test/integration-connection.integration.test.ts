import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";

process.env.APP_ENV = "test";

let connectorMode: "success" | "failure" = "success";
let connectorId = "shared-connection";

ReplitConnectors.prototype.listConnections = async function () {
  if (connectorMode === "failure") {
    throw new Error("simulated managed connector outage");
  }
  return [{
    id: connectorId,
    connector_name: "google-mail",
    customer_id: "integration-test-customer",
    status: "connected",
  }];
};

const {
  db,
  environmentsTable,
  integrationAuditEventsTable,
  integrationEntitlementsTable,
  integrationsTable,
  membershipsTable,
  pool,
  tenantEnvironmentAccessTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const { default: app } = await import("../src/app.ts");

type Json = Record<string, unknown> | unknown[];

const runId = `${Date.now()}-${process.pid}`;
const clerkIds = {
  ownerA: `integration-connection-owner-a-${runId}`,
  adminA: `integration-connection-admin-a-${runId}`,
  memberA: `integration-connection-member-a-${runId}`,
  viewerA: `integration-connection-viewer-a-${runId}`,
  ownerB: `integration-connection-owner-b-${runId}`,
};

let server: Server;
let baseUrl = "";
let tenantAId: number;
let tenantBId: number;
let environmentAProductionId: number;
let environmentADevelopmentId: number;
let environmentBId: number;
let ownerAId: number;

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
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Json : undefined,
  };
}

async function setActiveEnvironment(userId: number, tenantId: number, environmentId: number) {
  await db.update(userTenantContextTable).set({
    activeTenantId: tenantId,
    activeEnvironmentId: environmentId,
    updatedAt: new Date(),
  }).where(eq(userTenantContextTable.userId, userId));
}

before(async () => {
  const [tenantA, tenantB] = await db.insert(tenantsTable).values([
    { name: `Integration Connection Tenant A ${runId}`, slug: `integration-connection-a-${runId}` },
    { name: `Integration Connection Tenant B ${runId}`, slug: `integration-connection-b-${runId}` },
  ]).returning();
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  const [environmentAProduction, environmentADevelopment, environmentB] = await db.insert(environmentsTable).values([
    {
      tenantId: tenantAId,
      name: "Production",
      slug: `production-${runId}`,
      kind: "production",
      status: "active",
    },
    {
      tenantId: tenantAId,
      name: "Development / Test / Demo",
      slug: `dtd-${runId}`,
      kind: "dtd",
      status: "active",
    },
    {
      tenantId: tenantBId,
      name: "Production",
      slug: `production-${runId}`,
      kind: "production",
      status: "active",
    },
  ]).returning();
  environmentAProductionId = environmentAProduction.id;
  environmentADevelopmentId = environmentADevelopment.id;
  environmentBId = environmentB.id;

  const users = await db.insert(usersTable).values([
    { clerkUserId: clerkIds.ownerA, email: `${clerkIds.ownerA}@integration.test`, displayName: "Owner A" },
    { clerkUserId: clerkIds.adminA, email: `${clerkIds.adminA}@integration.test`, displayName: "Admin A" },
    { clerkUserId: clerkIds.memberA, email: `${clerkIds.memberA}@integration.test`, displayName: "Member A" },
    { clerkUserId: clerkIds.viewerA, email: `${clerkIds.viewerA}@integration.test`, displayName: "Viewer A" },
    { clerkUserId: clerkIds.ownerB, email: `${clerkIds.ownerB}@integration.test`, displayName: "Owner B" },
  ]).returning();
  const userByClerkId = new Map(users.map((user) => [user.clerkUserId, user]));
  ownerAId = userByClerkId.get(clerkIds.ownerA)!.id;

  await db.insert(membershipsTable).values([
    { tenantId: tenantAId, userId: userByClerkId.get(clerkIds.ownerA)!.id, role: "owner", environmentAccessConfigured: true },
    { tenantId: tenantAId, userId: userByClerkId.get(clerkIds.adminA)!.id, role: "admin", environmentAccessConfigured: true },
    { tenantId: tenantAId, userId: userByClerkId.get(clerkIds.memberA)!.id, role: "member", environmentAccessConfigured: true },
    { tenantId: tenantAId, userId: userByClerkId.get(clerkIds.viewerA)!.id, role: "viewer", environmentAccessConfigured: true },
    { tenantId: tenantBId, userId: userByClerkId.get(clerkIds.ownerB)!.id, role: "owner", environmentAccessConfigured: true },
  ]);
  await db.insert(tenantEnvironmentAccessTable).values([
    ...[clerkIds.ownerA, clerkIds.adminA, clerkIds.memberA, clerkIds.viewerA].flatMap((clerkUserId) => [
      {
        tenantId: tenantAId,
        environmentId: environmentAProductionId,
        userId: userByClerkId.get(clerkUserId)!.id,
        grantedByUserId: ownerAId,
      },
      ...(clerkUserId === clerkIds.ownerA ? [{
        tenantId: tenantAId,
        environmentId: environmentADevelopmentId,
        userId: userByClerkId.get(clerkUserId)!.id,
        grantedByUserId: ownerAId,
      }] : []),
    ]),
    {
      tenantId: tenantBId,
      environmentId: environmentBId,
      userId: userByClerkId.get(clerkIds.ownerB)!.id,
      grantedByUserId: userByClerkId.get(clerkIds.ownerB)!.id,
    },
  ]);
  await db.insert(userTenantContextTable).values([
    ...[clerkIds.ownerA, clerkIds.adminA, clerkIds.memberA, clerkIds.viewerA].map((clerkUserId) => ({
      userId: userByClerkId.get(clerkUserId)!.id,
      activeTenantId: tenantAId,
      activeEnvironmentId: environmentAProductionId,
    })),
    {
      userId: userByClerkId.get(clerkIds.ownerB)!.id,
      activeTenantId: tenantBId,
      activeEnvironmentId: environmentBId,
    },
  ]);
  await db.insert(integrationEntitlementsTable).values([
    { tenantId: tenantAId, capabilityKey: "google_workspace", enabled: true },
    { tenantId: tenantBId, capabilityKey: "google_workspace", enabled: true },
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
  await db.delete(usersTable).where(inArray(usersTable.clerkUserId, Object.values(clerkIds)));
  await pool.end();
});

test("requires owner/admin access and an enabled provider entitlement", async () => {
  const memberConnect = await request(clerkIds.memberA, "/integrations/google_workspace/connect", { method: "POST" });
  assert.equal(memberConnect.status, 403);

  const viewerRevoke = await request(clerkIds.viewerA, "/integrations/google_workspace/revoke", { method: "POST" });
  assert.equal(viewerRevoke.status, 403);

  const unentitledConnect = await request(clerkIds.ownerA, "/integrations/docusign/connect", { method: "POST" });
  assert.equal(unentitledConnect.status, 404);

  const unentitledRevoke = await request(clerkIds.ownerA, "/integrations/docusign/revoke", { method: "POST" });
  assert.equal(unentitledRevoke.status, 404);
});

test("attaches, confirms, rejects cross-environment and cross-tenant reuse, reconnects, and revokes cleanly", async () => {
  connectorMode = "success";
  connectorId = "shared-connection";

  const connected = await request(clerkIds.ownerA, "/integrations/google_workspace/connect", { method: "POST" });
  assert.equal(connected.status, 200, JSON.stringify(connected.body));
  assert.equal(JSON.stringify(connected.body).includes("shared-connection"), false);

  const [initialRow] = await db.select().from(integrationsTable).where(and(
    eq(integrationsTable.tenantId, tenantAId),
    eq(integrationsTable.environmentId, environmentAProductionId),
    eq(integrationsTable.providerKey, "google_workspace"),
  ));
  assert.equal(initialRow?.status, "connected");
  assert.equal(initialRow?.credentialsReference, "replit-connector:google-mail:shared-connection");

  const confirmed = await request(clerkIds.adminA, "/integrations/google_workspace/connect", { method: "POST" });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));

  await setActiveEnvironment(ownerAId, tenantAId, environmentADevelopmentId);
  const crossEnvironment = await request(clerkIds.ownerA, "/integrations/google_workspace/connect", { method: "POST" });
  assert.equal(crossEnvironment.status, 409);

  const crossTenant = await request(clerkIds.ownerB, "/integrations/google_workspace/connect", { method: "POST" });
  assert.equal(crossTenant.status, 409);

  await setActiveEnvironment(ownerAId, tenantAId, environmentAProductionId);
  connectorId = "replacement-connection";
  const reconnected = await request(clerkIds.ownerA, "/integrations/google_workspace/connect", { method: "POST" });
  assert.equal(reconnected.status, 200, JSON.stringify(reconnected.body));

  const [reconnectedRow] = await db.select().from(integrationsTable).where(and(
    eq(integrationsTable.tenantId, tenantAId),
    eq(integrationsTable.environmentId, environmentAProductionId),
    eq(integrationsTable.providerKey, "google_workspace"),
  ));
  assert.equal(reconnectedRow?.credentialsReference, "replit-connector:google-mail:replacement-connection");

  const revoked = await request(clerkIds.ownerA, "/integrations/google_workspace/revoke", { method: "POST" });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  const [revokedRow] = await db.select().from(integrationsTable).where(eq(integrationsTable.id, reconnectedRow!.id));
  assert.equal(revokedRow?.status, "not_connected");
  assert.equal(revokedRow?.connectionType, "not_configured");
  assert.equal(revokedRow?.configuration, "{}");
  assert.equal(revokedRow?.credentialsReference, null);
  assert.equal(revokedRow?.lastSyncAt, null);
  assert.equal(revokedRow?.lastSyncStatus, null);
  assert.equal(revokedRow?.lastError, null);

  const duplicateRevoke = await request(clerkIds.ownerA, "/integrations/google_workspace/revoke", { method: "POST" });
  assert.equal(duplicateRevoke.status, 404);

  const tenantAAudit = await db.select().from(integrationAuditEventsTable)
    .where(eq(integrationAuditEventsTable.tenantId, tenantAId));
  const actions = tenantAAudit.map((event) => event.action);
  assert.equal(actions.includes("connected"), true);
  assert.equal(actions.includes("connection_confirmed"), true);
  assert.equal(actions.includes("reconnected"), true);
  assert.equal(actions.includes("revoked"), true);
  assert.equal(tenantAAudit.some((event) => event.action === "connection_failed" && event.environmentId === environmentADevelopmentId), true);
  assert.equal(tenantAAudit.every((event) => !event.details.includes("replacement-connection")), true);
  assert.equal(tenantAAudit.every((event) => !event.details.includes("shared-connection")), true);

  const tenantBAudit = await db.select().from(integrationAuditEventsTable)
    .where(eq(integrationAuditEventsTable.tenantId, tenantBId));
  assert.equal(tenantBAudit.some((event) => event.action === "connection_failed"), true);
});

test("records managed connector lookup failures without creating a connection", async () => {
  connectorMode = "failure";
  await setActiveEnvironment(ownerAId, tenantAId, environmentAProductionId);

  const failed = await request(clerkIds.ownerA, "/integrations/google_workspace/connect", { method: "POST" });
  assert.equal(failed.status, 424);

  const [row] = await db.select().from(integrationsTable).where(and(
    eq(integrationsTable.tenantId, tenantAId),
    eq(integrationsTable.environmentId, environmentAProductionId),
    eq(integrationsTable.providerKey, "google_workspace"),
  ));
  assert.equal(row?.status, "not_connected");

  const [audit] = await db.select().from(integrationAuditEventsTable)
    .where(and(
      eq(integrationAuditEventsTable.tenantId, tenantAId),
      eq(integrationAuditEventsTable.environmentId, environmentAProductionId),
      eq(integrationAuditEventsTable.action, "connection_failed"),
    ))
    .orderBy(integrationAuditEventsTable.createdAt)
    .limit(1);
  assert.equal(audit?.details, JSON.stringify({ reason: "connector_unavailable" }));
});