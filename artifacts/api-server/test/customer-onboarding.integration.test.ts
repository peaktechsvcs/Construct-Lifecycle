import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { createCustomerWorkspace } from "../src/lib/customer-onboarding.ts";
import { createPlatformCustomerHandler } from "../src/routes/platform.ts";
import {
  ActiveTenantInvitationError,
  createTenantInvitation,
} from "../src/routes/tenant-admin.ts";

const {
  db,
  pool,
  platformAuditEventsTable,
  tenantsTable,
  tenantInvitationsTable,
  usersTable,
} = await import("@workspace/db");
const slug = `onboarding-rollback-${Date.now()}-${process.pid}`;
const partialSlug = `onboarding-partial-${Date.now()}-${process.pid}`;
const testClerkUserId = `onboarding-owner-${Date.now()}-${process.pid}`;
const retryClerkUserId = `onboarding-retry-owner-${Date.now()}-${process.pid}`;

after(async () => {
  await db.delete(tenantsTable).where(eq(tenantsTable.slug, slug));
  await db.delete(tenantsTable).where(eq(tenantsTable.slug, partialSlug));
  for (const clerkUserId of [testClerkUserId, retryClerkUserId]) {
    const [owner] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .limit(1);
    if (owner) {
      await db.delete(platformAuditEventsTable).where(eq(platformAuditEventsTable.actorUserId, owner.id));
    }
  }
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, testClerkUserId));
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, retryClerkUserId));
  await pool.end();
});

test("returns the safe recovery message and rolls back when setup fails", async () => {
  const [retryOwner] = await db.insert(usersTable).values({
    clerkUserId: retryClerkUserId,
    email: "onboarding-retry-owner@example.test",
    displayName: "Onboarding Retry Owner",
  }).returning({ id: usersTable.id });
  let statusCode = 200;
  let responseBody: unknown;
  let workflowShouldFail = true;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
      return this;
    },
  };
  const request = {
    body: {
      name: "Workflow Failure Customer",
      slug,
      businessTypes: ["general-contractor"],
    },
    localUserId: retryOwner.id,
    log: { error() {} },
  };
  const createWorkspace = (input: Parameters<typeof createCustomerWorkspace>[0], userId: number | undefined) =>
    createCustomerWorkspace(input, userId, async () => {
      if (workflowShouldFail) throw new Error("simulated default workflow failure");
    });

  await createPlatformCustomerHandler(
    request as never,
    response as never,
    createWorkspace,
  );

  assert.equal(statusCode, 500);
  assert.deepEqual(responseBody, {
    error: "Customer workspace setup failed. No workspace was created. Please try again.",
  });

  const [tenant] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, slug))
    .limit(1);
  assert.equal(tenant, undefined);

  workflowShouldFail = false;
  statusCode = 200;
  responseBody = undefined;

  await createPlatformCustomerHandler(
    request as never,
    response as never,
    createWorkspace,
  );

  assert.equal(statusCode, 201);
  assert.equal((responseBody as { customer?: { slug?: string } }).customer?.slug, slug);

  const customers = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, slug));
  assert.equal(customers.length, 1);
});

test("returns partial success when the workspace exists but its owner invitation fails", async () => {
  const [user] = await db.insert(usersTable).values({
    clerkUserId: testClerkUserId,
    email: "onboarding-owner@example.test",
    displayName: "Onboarding Owner",
  }).returning({ id: usersTable.id });
  let statusCode = 200;
  let responseBody: Record<string, unknown> | undefined;
  const logMessages: unknown[] = [];
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      responseBody = body;
      return this;
    },
  };
  const request = {
    body: {
      name: "Partial Success Customer",
      slug: partialSlug,
      ownerEmail: "owner@example.test",
      businessTypes: ["general-contractor"],
    },
    localUserId: user.id,
    log: { error(...args: unknown[]) { logMessages.push(args); } },
  };

  await createPlatformCustomerHandler(
    request as never,
    response as never,
    (input, userId) => createCustomerWorkspace(input, userId, async () => {}),
    async () => {
      throw new Error("simulated invitation provider failure");
    },
  );

  assert.equal(statusCode, 201);
  assert.equal(responseBody?.invitationStatus, "failed");
  assert.equal(responseBody?.invitation, null);
  assert.equal(responseBody?.invitationToken, null);
  assert.equal(
    responseBody?.invitationError,
    "Workspace created, but the owner invitation could not be created. Retry it from customer access.",
  );
  assert.equal(logMessages.length, 1);
  assert.doesNotMatch(JSON.stringify(logMessages), /owner@example\.test|provider failure|token/i);

  const [tenant] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, partialSlug))
    .limit(1);
  assert.ok(tenant);

  const [first, second] = await Promise.allSettled([
    createTenantInvitation(tenant.id, user.id, "retry-owner@example.test", "owner"),
    createTenantInvitation(tenant.id, user.id, "retry-owner@example.test", "owner"),
  ]);
  assert.equal([first, second].filter((result) => result.status === "fulfilled").length, 1);
  assert.equal([first, second].filter((result) => result.status === "rejected").length, 1);
  const rejected = [first, second].find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.reason instanceof ActiveTenantInvitationError);

  const invitations = await db
    .select({ id: tenantInvitationsTable.id })
    .from(tenantInvitationsTable)
    .where(eq(tenantInvitationsTable.tenantId, tenant.id));
  assert.equal(invitations.length, 1);
});