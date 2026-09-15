import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";

process.env.APP_ENV = "test";

const {
  db,
  environmentsTable,
  membershipsTable,
  pool,
  projectsTable,
  submittalPackageAssembliesTable,
  submittalPackagesTable,
  submittalSignatureRequestsTable,
  tenantEnvironmentAccessTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const { default: app } = await import("../src/app.ts");

const runId = `${Date.now()}-${process.pid}`;
const clerkUserIds = {
  tenantA: `signature-isolation-a-${runId}`,
  tenantB: `signature-isolation-b-${runId}`,
};

let server: Server;
let baseUrl = "";
let tenantAId: number;
let tenantBId: number;
let environmentADtdId: number;
let environmentAProductionId: number;
let environmentBId: number;
let packageAId: number;
let packageAOtherId: number;
let packageAProductionId: number;
let packageBId: number;
let assemblyAId: number;
let assemblyAOtherPackageId: number;
let assemblyAProductionId: number;
let assemblyBId: number;
let nonReadyAssemblyId: number;
let failedAssemblyId: number;

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
    body: text ? JSON.parse(text) as Record<string, unknown> | unknown[] : undefined,
  };
}

async function setActiveEnvironment(userId: number, tenantId: number, environmentId: number) {
  await db.update(userTenantContextTable)
    .set({ activeTenantId: tenantId, activeEnvironmentId: environmentId })
    .where(eq(userTenantContextTable.userId, userId));
}

const signerBody = (name = "Jordan Lee") => ({
  signers: [{ name, email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`, role: "Owner" }],
});

before(async () => {
  const [tenantA, tenantB] = await db.insert(tenantsTable).values([
    { name: "Signature Isolation A", slug: `signature-isolation-a-${runId}` },
    { name: "Signature Isolation B", slug: `signature-isolation-b-${runId}` },
  ]).returning();
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  const [environmentADtd, environmentAProduction, environmentB] = await db.insert(environmentsTable).values([
    { tenantId: tenantAId, name: "Development / Test / Demo", slug: "dtd", kind: "dtd", status: "active" },
    { tenantId: tenantAId, name: "Production", slug: "production", kind: "production", status: "active" },
    { tenantId: tenantBId, name: "Development / Test / Demo", slug: "dtd", kind: "dtd", status: "active" },
  ]).returning();
  environmentADtdId = environmentADtd.id;
  environmentAProductionId = environmentAProduction.id;
  environmentBId = environmentB.id;

  const [userA, userB] = await db.insert(usersTable).values([
    {
      clerkUserId: clerkUserIds.tenantA,
      email: `${clerkUserIds.tenantA}@integration.test`,
      displayName: "Signature Tenant A",
    },
    {
      clerkUserId: clerkUserIds.tenantB,
      email: `${clerkUserIds.tenantB}@integration.test`,
      displayName: "Signature Tenant B",
    },
  ]).returning();
  await db.insert(membershipsTable).values([
    { tenantId: tenantAId, userId: userA.id, role: "owner", environmentAccessConfigured: true },
    { tenantId: tenantBId, userId: userB.id, role: "owner", environmentAccessConfigured: true },
  ]);
  await db.insert(tenantEnvironmentAccessTable).values([
    { tenantId: tenantAId, environmentId: environmentADtdId, userId: userA.id, grantedByUserId: userA.id },
    { tenantId: tenantAId, environmentId: environmentAProductionId, userId: userA.id, grantedByUserId: userA.id },
    { tenantId: tenantBId, environmentId: environmentBId, userId: userB.id, grantedByUserId: userB.id },
  ]);
  await db.insert(userTenantContextTable).values([
    { userId: userA.id, activeTenantId: tenantAId, activeEnvironmentId: environmentADtdId },
    { userId: userB.id, activeTenantId: tenantBId, activeEnvironmentId: environmentBId },
  ]);

  const [projectA, projectAOther, projectAProduction, projectB] = await db.insert(projectsTable).values([
    { projectNumber: `SIG-${runId}-A`, customerName: "Customer A", projectName: "Project A", category: "commercial", tenantId: tenantAId, environmentId: environmentADtdId },
    { projectNumber: `SIG-${runId}-A2`, customerName: "Customer A", projectName: "Project A2", category: "commercial", tenantId: tenantAId, environmentId: environmentADtdId },
    { projectNumber: `SIG-${runId}-AP`, customerName: "Customer A", projectName: "Project A Production", category: "commercial", tenantId: tenantAId, environmentId: environmentAProductionId },
    { projectNumber: `SIG-${runId}-B`, customerName: "Customer B", projectName: "Project B", category: "commercial", tenantId: tenantBId, environmentId: environmentBId },
  ]).returning();
  const [packageA, packageAOther, packageAProduction, packageB] = await db.insert(submittalPackagesTable).values([
    { packageNumber: `A-${runId}`, projectId: projectA.id, name: "Package A", tenantId: tenantAId, environmentId: environmentADtdId },
    { packageNumber: `A2-${runId}`, projectId: projectAOther.id, name: "Package A2", tenantId: tenantAId, environmentId: environmentADtdId },
    { packageNumber: `AP-${runId}`, projectId: projectAProduction.id, name: "Package A Production", tenantId: tenantAId, environmentId: environmentAProductionId },
    { packageNumber: `B-${runId}`, projectId: projectB.id, name: "Package B", tenantId: tenantBId, environmentId: environmentBId },
  ]).returning();
  packageAId = packageA.id;
  packageAOtherId = packageAOther.id;
  packageAProductionId = packageAProduction.id;
  packageBId = packageB.id;

  const [assemblyA, assemblyAOtherPackage, assemblyAProduction, assemblyB, nonReadyAssembly, failedAssembly] =
    await db.insert(submittalPackageAssembliesTable).values([
      { packageId: packageAId, version: 1, status: "ready", signatureReady: true, originalFileName: "a.pdf", objectPath: `signature-tests/${runId}/a.pdf`, size: 10, itemOrder: "[]", pagePlan: "[]" , tenantId: tenantAId, environmentId: environmentADtdId },
      { packageId: packageAOtherId, version: 1, status: "ready", signatureReady: true, originalFileName: "a2.pdf", objectPath: `signature-tests/${runId}/a2.pdf`, size: 10, itemOrder: "[]", pagePlan: "[]", tenantId: tenantAId, environmentId: environmentADtdId },
      { packageId: packageAProductionId, version: 1, status: "ready", signatureReady: true, originalFileName: "ap.pdf", objectPath: `signature-tests/${runId}/ap.pdf`, size: 10, itemOrder: "[]", pagePlan: "[]", tenantId: tenantAId, environmentId: environmentAProductionId },
      { packageId: packageBId, version: 1, status: "ready", signatureReady: true, originalFileName: "b.pdf", objectPath: `signature-tests/${runId}/b.pdf`, size: 10, itemOrder: "[]", pagePlan: "[]", tenantId: tenantBId, environmentId: environmentBId },
      { packageId: packageAId, version: 2, status: "building", signatureReady: false, originalFileName: "pending.pdf", objectPath: `signature-tests/${runId}/pending.pdf`, size: 10, itemOrder: "[]", pagePlan: "[]", tenantId: tenantAId, environmentId: environmentADtdId },
      { packageId: packageAId, version: 3, status: "failed", signatureReady: false, originalFileName: "failed.pdf", objectPath: `signature-tests/${runId}/failed.pdf`, size: 10, itemOrder: "[]", pagePlan: "[]", tenantId: tenantAId, environmentId: environmentADtdId },
    ]).returning();
  assemblyAId = assemblyA.id;
  assemblyAOtherPackageId = assemblyAOtherPackage.id;
  assemblyAProductionId = assemblyAProduction.id;
  assemblyBId = assemblyB.id;
  nonReadyAssemblyId = nonReadyAssembly.id;
  failedAssemblyId = failedAssembly.id;

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

test("tenant and environment boundaries hide packages, assemblies, and signature requests", async () => {
  const otherTenantPackageRead = await request(clerkUserIds.tenantB, `/submittals/${packageAId}`);
  assert.equal(otherTenantPackageRead.status, 404);
  const otherTenantPackageMutation = await request(clerkUserIds.tenantB, `/submittals/${packageAId}`, {
    method: "PATCH",
    body: JSON.stringify({ description: "cross-tenant mutation" }),
  });
  assert.equal(otherTenantPackageMutation.status, 404);
  const otherTenantPackage = await request(clerkUserIds.tenantB, `/submittals/${packageAId}/signature-requests`);
  assert.equal(otherTenantPackage.status, 404);
  const otherTenantAssembly = await request(clerkUserIds.tenantB, `/submittal-assemblies/${assemblyAId}`);
  assert.equal(otherTenantAssembly.status, 404);
  const otherTenantMutation = await request(clerkUserIds.tenantB, `/submittal-assemblies/${assemblyAId}/signature-ready`, { method: "POST", body: "{}" });
  assert.equal(otherTenantMutation.status, 404);

  const [userA] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkUserId, clerkUserIds.tenantA));
  const dtdReadingProduction = await request(clerkUserIds.tenantA, `/submittals/${packageAProductionId}`);
  assert.equal(dtdReadingProduction.status, 404);
  const dtdMutatingProduction = await request(clerkUserIds.tenantA, `/submittals/${packageAProductionId}`, {
    method: "PATCH",
    body: JSON.stringify({ description: "cross-environment mutation" }),
  });
  assert.equal(dtdMutatingProduction.status, 404);
  const dtdListingProduction = await request(clerkUserIds.tenantA, `/submittals/${packageAProductionId}/signature-requests`);
  assert.equal(dtdListingProduction.status, 404);
  await setActiveEnvironment(userA.id, tenantAId, environmentAProductionId);
  const productionReadingDtd = await request(clerkUserIds.tenantA, `/submittals/${packageAId}`);
  assert.equal(productionReadingDtd.status, 404);
  const otherEnvironmentPackage = await request(clerkUserIds.tenantA, `/submittals/${packageAId}/signature-requests`);
  assert.equal(otherEnvironmentPackage.status, 404);
  const otherEnvironmentAssembly = await request(clerkUserIds.tenantA, `/submittal-assemblies/${assemblyAId}`);
  assert.equal(otherEnvironmentAssembly.status, 404);
  const otherEnvironmentMutation = await request(clerkUserIds.tenantA, `/submittal-assemblies/${assemblyAId}/signature-ready`, { method: "POST", body: "{}" });
  assert.equal(otherEnvironmentMutation.status, 404);
  await setActiveEnvironment(userA.id, tenantAId, environmentADtdId);
});

test("preparation rejects an assembly belonging to a different package", async () => {
  const result = await request(clerkUserIds.tenantA, `/submittals/${packageAId}/signature-requests`, {
    method: "POST",
    body: JSON.stringify({ assemblyId: assemblyAOtherPackageId, ...signerBody() }),
  });
  assert.equal(result.status, 404);
});

test("preparation rejects non-ready and failed assemblies", async () => {
  for (const assemblyId of [nonReadyAssemblyId, failedAssemblyId]) {
    const result = await request(clerkUserIds.tenantA, `/submittals/${packageAId}/signature-requests`, {
      method: "POST",
      body: JSON.stringify({ assemblyId, ...signerBody() }),
    });
    assert.equal(result.status, 409);
  }
});

test("repeated preparation returns a conflict and leaves one active request", async () => {
  const first = await request(clerkUserIds.tenantA, `/submittals/${packageAId}/signature-requests`, {
    method: "POST",
    body: JSON.stringify({ assemblyId: assemblyAId, ...signerBody() }),
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await request(clerkUserIds.tenantA, `/submittals/${packageAId}/signature-requests`, {
    method: "POST",
    body: JSON.stringify({ assemblyId: assemblyAId, ...signerBody("Morgan Lee") }),
  });
  assert.equal(second.status, 409);
  const requests = await db.select({ id: submittalSignatureRequestsTable.id })
    .from(submittalSignatureRequestsTable)
    .where(and(
      eq(submittalSignatureRequestsTable.assemblyId, assemblyAId),
      inArray(submittalSignatureRequestsTable.status, ["draft", "ready", "sending", "sent", "partially_signed"]),
    ));
  assert.equal(requests.length, 1);
});

test("concurrent preparation creates only one active request", async () => {
  const results = await Promise.all(
    [1, 2].map((index) => request(clerkUserIds.tenantA, `/submittals/${packageAOtherId}/signature-requests`, {
      method: "POST",
      body: JSON.stringify({ assemblyId: assemblyAOtherPackageId, ...signerBody(`Concurrent ${index}`) }),
    })),
  );
  assert.deepEqual(results.map((result) => result.status).sort((a, b) => a - b), [201, 409]);
  const requests = await db.select({ id: submittalSignatureRequestsTable.id })
    .from(submittalSignatureRequestsTable)
    .where(and(
      eq(submittalSignatureRequestsTable.assemblyId, assemblyAOtherPackageId),
      inArray(submittalSignatureRequestsTable.status, ["draft", "ready", "sending", "sent", "partially_signed"]),
    ));
  assert.equal(requests.length, 1);
});