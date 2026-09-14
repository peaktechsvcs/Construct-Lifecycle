import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";

process.env.APP_ENV = "test";

const {
  businessCustomersTable,
  db,
  environmentsTable,
  membershipsTable,
  pool,
  projectsTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const { ensurePublishedWorkflow } = await import("../src/lib/workflow.ts");
const { default: app } = await import("../src/app.ts");

const runId = `${Date.now()}-${process.pid}`;
const clerkUserId = `customer-project-integrity-${runId}`;
const tenantSlug = `customer-project-integrity-${runId}`;

let server: Server;
let baseUrl = "";
let tenantId: number;
let environmentId: number;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  assert.equal(typeof value, "object");
  assert(value !== null);
  return value as JsonObject;
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-clerk-user-id": clerkUserId,
      ...init.headers,
    },
  });
  const text = await response.text();
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
}

async function createCustomer(companyName: string) {
  const result = await request("/customers", {
    method: "POST",
    body: JSON.stringify({ companyName }),
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return asObject(result.body);
}

async function createProject(businessCustomerId: number, projectName: string) {
  const result = await request("/projects", {
    method: "POST",
    body: JSON.stringify({
      businessCustomerId,
      projectName,
      category: "commercial",
    }),
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return asObject(result.body);
}

before(async () => {
  const [tenant] = await db.insert(tenantsTable).values({
    name: "Customer Project Integrity",
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
    displayName: "Customer Project Integrity",
  }).returning();
  await db.insert(membershipsTable).values({
    tenantId,
    userId: user.id,
    role: "owner",
  });
  await db.insert(userTenantContextTable).values({
    userId: user.id,
    activeTenantId: tenantId,
    activeEnvironmentId: environmentId,
  });
  await ensurePublishedWorkflow(tenantId, environmentId, user.id);

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

test("rejects exact normalized duplicate customer names within a tenant and environment", async () => {
  await createCustomer(`Acme   Builders ${runId}`);

  const duplicate = await request("/customers", {
    method: "POST",
    body: JSON.stringify({ companyName: `  acme-builders-${runId} ` }),
  });

  assert.equal(duplicate.status, 409);
  assert.equal(asObject(duplicate.body).error, "A customer with this name already exists");
});

test("excludes archived customers from selection and blocks project assignment until restored", async () => {
  const customer = await createCustomer(`Archived Customer ${runId}`);
  const customerId = Number(customer.id);

  const archived = await request(`/customers/${customerId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "archived" }),
  });
  assert.equal(archived.status, 200);

  const activeCustomers = await request("/customers");
  assert.equal(activeCustomers.status, 200);
  assert.equal(
    (activeCustomers.body as Array<JsonObject>).some((item) => item.id === customerId),
    false,
  );

  const allCustomers = await request("/customers?includeArchived=true");
  assert.equal(allCustomers.status, 200);
  assert.equal(
    (allCustomers.body as Array<JsonObject>).some((item) => item.id === customerId && item.status === "archived"),
    true,
  );

  const blockedProject = await request("/projects", {
    method: "POST",
    body: JSON.stringify({
      businessCustomerId: customerId,
      projectName: `Blocked archived assignment ${runId}`,
      category: "commercial",
    }),
  });
  assert.equal(blockedProject.status, 404);
  assert.match(String(asObject(blockedProject.body).error), /active environment/);

  const restored = await request(`/customers/${customerId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(restored.status, 200);

  const restoredProject = await createProject(customerId, `Restored customer project ${runId}`);
  assert.equal(restoredProject.businessCustomerId, customerId);
});

test("rolls back quick-created customer when project creation fails", async () => {
  const companyName = `Rollback Customer ${runId}`;
  const normalizedName = `rollback customer ${runId}`;

  const failed = await request("/projects", {
    method: "POST",
    body: JSON.stringify({
      newCustomer: { companyName },
      projectName: `Overflow project ${runId}`,
      category: "commercial",
      contractValue: 10_000_000_000,
    }),
  });

  assert.equal(failed.status, 500);
  const [customer] = await db
    .select({ id: businessCustomersTable.id })
    .from(businessCustomersTable)
    .where(and(
      eq(businessCustomersTable.tenantId, tenantId),
      eq(businessCustomersTable.environmentId, environmentId),
      eq(businessCustomersTable.normalizedName, normalizedName),
    ));
  assert.equal(customer, undefined);

  const [project] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(
      eq(projectsTable.tenantId, tenantId),
      eq(projectsTable.environmentId, environmentId),
      eq(projectsTable.projectName, `Overflow project ${runId}`),
    ));
  assert.equal(project, undefined);
});

test("renaming a customer keeps project links and updates legacy display values", async () => {
  const customer = await createCustomer(`Legacy Display Customer ${runId}`);
  const customerId = Number(customer.id);
  const project = await createProject(customerId, `Historical link project ${runId}`);
  const projectId = Number(project.id);

  const renamed = await request(`/customers/${customerId}`, {
    method: "PATCH",
    body: JSON.stringify({ companyName: `Renamed Customer ${runId}` }),
  });
  assert.equal(renamed.status, 200);

  const [storedProject] = await db
    .select({
      businessCustomerId: projectsTable.businessCustomerId,
      customerName: projectsTable.customerName,
    })
    .from(projectsTable)
    .where(and(
      eq(projectsTable.id, projectId),
      eq(projectsTable.tenantId, tenantId),
      eq(projectsTable.environmentId, environmentId),
    ));
  assert.equal(storedProject.businessCustomerId, customerId);
  assert.equal(storedProject.customerName, `Renamed Customer ${runId}`);

  const projectResponse = await request(`/projects/${projectId}`);
  assert.equal(projectResponse.status, 200);
  assert.equal(asObject(projectResponse.body).businessCustomerId, customerId);
  assert.equal(asObject(projectResponse.body).customerName, `Renamed Customer ${runId}`);
});