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
  tenantsTable,
  userTenantContextTable,
  usersTable,
  projectIssuesTable,
} = await import("@workspace/db");
const { default: app } = await import("../src/app.ts");

const runId = `${Date.now()}-${process.pid}`;
const clerkUserId = `project-controls-numbering-${runId}`;
const tenantSlug = `project-controls-numbering-${runId}`;

let server: Server;
let baseUrl = "";
let tenantId: number;
let environmentId: number;
let projectId: number;

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-clerk-user-id": clerkUserId,
      ...init.headers,
    },
  });
  const body = await response.json();
  return { status: response.status, body: body as { issueNumber?: string; error?: string } };
}

before(async () => {
  const [tenant] = await db.insert(tenantsTable).values({
    name: "Project Controls Numbering",
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
    displayName: "Project Controls Numbering",
  }).returning();
  await db.insert(membershipsTable).values({ tenantId, userId: user.id, role: "owner" });
  await db.insert(userTenantContextTable).values({
    userId: user.id,
    activeTenantId: tenantId,
    activeEnvironmentId: environmentId,
  });

  const [project] = await db.insert(projectsTable).values({
    projectNumber: `PCN-${runId}`,
    customerName: "Numbering Test Customer",
    projectName: "Concurrent Controls",
    category: "commercial",
    tenantId,
    environmentId,
  }).returning();
  projectId = project.id;

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

test("allocates unique per-type RFI and issue numbers under concurrent creates", async () => {
  const requests = [
    ...Array.from({ length: 12 }, (_, index) => ({ issueType: "rfi", subject: `Concurrent RFI ${index}` })),
    ...Array.from({ length: 12 }, (_, index) => ({ issueType: "issue", subject: `Concurrent issue ${index}` })),
  ].map((input) => request(`/projects/${projectId}/controls/issues`, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      question: `Question for ${input.subject}`,
    }),
  }));

  const results = await Promise.all(requests);
  assert.deepEqual(results.map((result) => result.status), Array(24).fill(201));

  const createdRows = await db.select({
    issueNumber: projectIssuesTable.issueNumber,
    issueType: projectIssuesTable.issueType,
  }).from(projectIssuesTable).where(and(
    eq(projectIssuesTable.tenantId, tenantId),
    eq(projectIssuesTable.environmentId, environmentId),
    eq(projectIssuesTable.projectId, projectId),
  ));
  const rfis = createdRows.filter((row) => row.issueType === "rfi").map((row) => row.issueNumber).sort();
  const issues = createdRows.filter((row) => row.issueType === "issue").map((row) => row.issueNumber).sort();
  assert.deepEqual(rfis, Array.from({ length: 12 }, (_, index) => `RFI-${String(index + 1).padStart(3, "0")}`));
  assert.deepEqual(issues, Array.from({ length: 12 }, (_, index) => `ISS-${String(index + 1).padStart(3, "0")}`));
});