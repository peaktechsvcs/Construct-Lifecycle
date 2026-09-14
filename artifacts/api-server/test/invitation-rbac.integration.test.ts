import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";

process.env.APP_ENV = "test";

const {
  db,
  environmentsTable,
  membershipsTable,
  platformAuditEventsTable,
  pool,
  tenantInvitationsTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const {
  createTenantInvitation,
  hashInvitationToken,
  invitationStatus,
} = await import("../src/routes/tenant-admin.ts");
const { default: app } = await import("../src/app.ts");

type Json = Record<string, unknown> | unknown[];

const runId = `${Date.now()}-${process.pid}`;
const clerkIds = {
  ownerA: `rbac-owner-a-${runId}`,
  adminA: `rbac-admin-a-${runId}`,
  memberA: `rbac-member-a-${runId}`,
  viewerA: `rbac-viewer-a-${runId}`,
  ownerB: `rbac-owner-b-${runId}`,
  invitee: `rbac-invitee-${runId}`,
  existingAdmin: `rbac-existing-admin-${runId}`,
  platformAdmin: `rbac-platform-admin-${runId}`,
};

let server: Server;
let baseUrl = "";
let tenantAId: number;
let tenantBId: number;
let suspendedTenantId: number;
let userId: Record<keyof typeof clerkIds, number>;

async function request(
  clerkUserId: string | undefined,
  path: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (clerkUserId) headers.set("x-test-clerk-user-id", clerkUserId);
  const response = await fetch(`${baseUrl}/api${path}`, { ...init, headers });
  const text = await response.text();
  let body: Json | undefined;
  if (text) {
    try {
      body = JSON.parse(text) as Json;
    } catch {
      body = { raw: text };
    }
  }
  return { status: response.status, body };
}

function bodyRecord(body: Json | undefined) {
  assert(body && !Array.isArray(body));
  return body as Record<string, unknown>;
}

before(async () => {
  const [tenantA, tenantB, suspendedTenant] = await db.insert(tenantsTable).values([
    { name: "Authorization Tenant A", slug: `rbac-a-${runId}` },
    { name: "Authorization Tenant B", slug: `rbac-b-${runId}` },
    { name: "Suspended Authorization Tenant", slug: `rbac-suspended-${runId}`, status: "suspended" },
  ]).returning();
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;
  suspendedTenantId = suspendedTenant.id;

  const environments = await db.insert(environmentsTable).values([
    { tenantId: tenantAId, name: "Test", slug: "test", kind: "dtd" },
    { tenantId: tenantBId, name: "Test", slug: "test", kind: "dtd" },
    { tenantId: suspendedTenantId, name: "Test", slug: "test", kind: "dtd" },
  ]).returning();

  const users = await db.insert(usersTable).values([
    { clerkUserId: clerkIds.ownerA, email: `owner-a-${runId}@integration.test`, displayName: "Owner A" },
    { clerkUserId: clerkIds.adminA, email: `admin-a-${runId}@integration.test`, displayName: "Admin A" },
    { clerkUserId: clerkIds.memberA, email: `member-a-${runId}@integration.test`, displayName: "Member A" },
    { clerkUserId: clerkIds.viewerA, email: `viewer-a-${runId}@integration.test`, displayName: "Viewer A" },
    { clerkUserId: clerkIds.ownerB, email: `owner-b-${runId}@integration.test`, displayName: "Owner B" },
    { clerkUserId: clerkIds.invitee, email: `invitee-${runId}@integration.test`, displayName: "Invitee" },
    { clerkUserId: clerkIds.existingAdmin, email: `existing-admin-${runId}@integration.test`, displayName: "Existing Admin" },
    {
      clerkUserId: clerkIds.platformAdmin,
      email: `platform-admin-${runId}@integration.test`,
      displayName: "Platform Admin",
      isPlatformAdmin: true,
    },
  ]).returning();
  userId = Object.fromEntries(
    Object.entries(clerkIds).map(([name, clerkUserId]) => [
      name,
      users.find((user) => user.clerkUserId === clerkUserId)!.id,
    ]),
  ) as typeof userId;

  await db.insert(membershipsTable).values([
    { tenantId: tenantAId, userId: userId.ownerA, role: "owner" },
    { tenantId: tenantAId, userId: userId.adminA, role: "admin" },
    { tenantId: tenantAId, userId: userId.memberA, role: "member" },
    { tenantId: tenantAId, userId: userId.viewerA, role: "viewer" },
    { tenantId: tenantBId, userId: userId.ownerB, role: "owner" },
    { tenantId: tenantAId, userId: userId.existingAdmin, role: "admin" },
  ]);

  await db.insert(userTenantContextTable).values(
    users.map((user) => ({
      userId: user.id,
      activeTenantId: user.clerkUserId === clerkIds.ownerB ? tenantBId : tenantAId,
      activeEnvironmentId: user.clerkUserId === clerkIds.ownerB ? environments[1].id : environments[0].id,
    })),
  );

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
  if (tenantAId && tenantBId && suspendedTenantId) {
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, [tenantAId, tenantBId, suspendedTenantId]));
  }
  if (userId) {
    await db.delete(platformAuditEventsTable).where(inArray(platformAuditEventsTable.actorUserId, Object.values(userId)));
    await db.delete(usersTable).where(inArray(usersTable.id, Object.values(userId)));
  }
  await pool.end();
});

describe("invitation and role authorization regressions", () => {
  test("keeps normal workspace routes open while guarding platform administration", async () => {
    assert.equal((await request(undefined, "/tenant/members")).status, 401);
    assert.equal((await request(clerkIds.memberA, "/projects")).status, 200);
    assert.equal((await request(clerkIds.viewerA, "/tenant/invitations")).status, 403);
    assert.equal((await request(clerkIds.ownerA, "/platform/customers")).status, 403);
    assert.equal((await request(clerkIds.platformAdmin, "/platform/customers")).status, 200);
  });

  test("resolves customer scope from authenticated membership instead of request input", async () => {
    const members = await request(
      clerkIds.ownerA,
      `/tenant/members?tenantId=${tenantBId}`,
    );
    assert.equal(members.status, 200);
    assert.match(JSON.stringify(members.body), new RegExp(`owner-a-${runId}`));
    assert.doesNotMatch(JSON.stringify(members.body), new RegExp(`owner-b-${runId}`));

    const invitation = await request(clerkIds.ownerA, "/tenant/invitations", {
      method: "POST",
      body: JSON.stringify({
        tenantId: tenantBId,
        email: `scoped-${runId}@integration.test`,
        role: "member",
      }),
    });
    assert.equal(invitation.status, 201);
    const invitationId = bodyRecord(invitation.body).invitation as Record<string, unknown>;
    assert.equal(invitationId.tenantId, tenantAId);

    const switchAttempt = await request(clerkIds.ownerA, "/tenant/context", {
      method: "POST",
      body: JSON.stringify({ tenantId: tenantBId }),
    });
    assert.equal(switchAttempt.status, 403);
  });

  test("hashes invitation tokens and reports pending, expired, revoked, and accepted states", () => {
    assert.equal(
      hashInvitationToken("known-token"),
      "49e2e40e591e61357758299c8cee170fb9fa7da160ec8acf110a4a409d905aaf",
    );
    assert.notEqual(hashInvitationToken("known-token"), hashInvitationToken("other-token"));

    const pending = { acceptedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) };
    assert.equal(invitationStatus(pending), "pending");
    assert.equal(invitationStatus({ ...pending, expiresAt: new Date(Date.now() - 1) }), "expired");
    assert.equal(invitationStatus({ ...pending, revokedAt: new Date() }), "revoked");
    assert.equal(invitationStatus({ ...pending, acceptedAt: new Date() }), "accepted");
  });

  test("blocks duplicate invitations and preserves owner-only invitation rules", async () => {
    const email = `duplicate-${runId}@integration.test`;
    const created = await request(clerkIds.ownerA, "/tenant/invitations", {
      method: "POST",
      body: JSON.stringify({ email, role: "member" }),
    });
    assert.equal(created.status, 201);

    const duplicate = await request(clerkIds.ownerA, "/tenant/invitations", {
      method: "POST",
      body: JSON.stringify({ email, role: "member" }),
    });
    assert.equal(duplicate.status, 409);

    const adminOwnerInvite = await request(clerkIds.adminA, "/tenant/invitations", {
      method: "POST",
      body: JSON.stringify({ email: `owner-invite-${runId}@integration.test`, role: "owner" }),
    });
    assert.equal(adminOwnerInvite.status, 403);
  });

  test("accepts valid invitations without downgrading an existing member", async () => {
    const accepted = await createTenantInvitation(
      tenantAId,
      userId.ownerA,
      `invitee-${runId}@integration.test`,
      "admin",
    );
    const response = await request(clerkIds.invitee, `/tenant/invitations/token/${accepted.token}/accept`, {
      method: "POST",
    });
    assert.equal(response.status, 200);

    const [membership] = await db
      .select()
      .from(membershipsTable)
      .where(and(eq(membershipsTable.tenantId, tenantAId), eq(membershipsTable.userId, userId.invitee)));
    assert.equal(membership.role, "admin");

    const [invitation] = await db
      .select()
      .from(tenantInvitationsTable)
      .where(eq(tenantInvitationsTable.id, accepted.invitation.id));
    assert(invitation.acceptedAt);
    assert.equal(
      (await request(clerkIds.invitee, `/tenant/invitations/token/${accepted.token}/accept`, { method: "POST" })).status,
      409,
    );

    const existingAdminInvite = await createTenantInvitation(
      tenantAId,
      userId.ownerA,
      `existing-admin-${runId}@integration.test`,
      "member",
    );
    assert.equal(
      (await request(clerkIds.existingAdmin, `/tenant/invitations/token/${existingAdminInvite.token}/accept`, { method: "POST" })).status,
      200,
    );
    const [existingAdminMembership] = await db
      .select()
      .from(membershipsTable)
      .where(and(eq(membershipsTable.tenantId, tenantAId), eq(membershipsTable.userId, userId.existingAdmin)));
    assert.equal(existingAdminMembership.role, "admin");
  });

  test("rejects expired invitations and treats suspended customers as revoked", async () => {
    const expired = await createTenantInvitation(
      tenantAId,
      userId.ownerA,
      `expired-${runId}@integration.test`,
      "member",
    );
    await db
      .update(tenantInvitationsTable)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(tenantInvitationsTable.id, expired.invitation.id));
    const expiredDetails = await request(clerkIds.invitee, `/tenant/invitations/token/${expired.token}`);
    assert.equal(expiredDetails.status, 200);
    assert.equal(bodyRecord(expiredDetails.body).status, "expired");
    assert.equal(
      (await request(clerkIds.invitee, `/tenant/invitations/token/${expired.token}/accept`, { method: "POST" })).status,
      409,
    );

    const suspended = await createTenantInvitation(
      suspendedTenantId,
      userId.ownerA,
      `suspended-${runId}@integration.test`,
      "member",
    );
    const suspendedDetails = await request(clerkIds.invitee, `/tenant/invitations/token/${suspended.token}`);
    assert.equal(suspendedDetails.status, 200);
    assert.equal(bodyRecord(suspendedDetails.body).status, "revoked");
    assert.equal(
      (await request(clerkIds.invitee, `/tenant/invitations/token/${suspended.token}/accept`, { method: "POST" })).status,
      409,
    );

    const suspendedPlatformInvite = await request(
      clerkIds.platformAdmin,
      `/platform/customers/${suspendedTenantId}/invitations`,
      {
        method: "POST",
        body: JSON.stringify({ email: `blocked-${runId}@integration.test`, role: "member" }),
      },
    );
    assert.equal(suspendedPlatformInvite.status, 409);
  });

  test("lets platform admins revoke pending invitations and blocks acceptance", async () => {
    const created = await createTenantInvitation(
      tenantAId,
      userId.ownerA,
      `platform-revoke-${runId}@integration.test`,
      "member",
    );
    const revoked = await request(
      clerkIds.platformAdmin,
      `/platform/customers/${tenantAId}/invitations/${created.invitation.id}/revoke`,
      { method: "POST" },
    );
    assert.equal(revoked.status, 200);
    assert.equal(bodyRecord(revoked.body).status, "revoked");

    const accepted = await request(
      clerkIds.invitee,
      `/tenant/invitations/token/${created.token}/accept`,
      { method: "POST" },
    );
    assert.equal(accepted.status, 409);

    const customer = await request(clerkIds.platformAdmin, `/platform/customers/${tenantAId}`);
    assert.equal(customer.status, 200);
    const invitations = bodyRecord(customer.body).invitations as Array<Record<string, unknown>>;
    assert.equal(invitations.find((invitation) => invitation.id === created.invitation.id)?.status, "revoked");

    const audit = await db
      .select()
      .from(platformAuditEventsTable)
      .where(and(
        eq(platformAuditEventsTable.tenantId, tenantAId),
        eq(platformAuditEventsTable.action, "customer_invitation_revoked"),
      ));
    assert.equal(audit.length, 1);
    assert.equal(JSON.parse(audit[0].details).invitationId, created.invitation.id);
    assert.equal(JSON.parse(audit[0].details).email, undefined);

    assert.equal(
      (await request(
        clerkIds.ownerA,
        `/platform/customers/${tenantAId}/invitations/${created.invitation.id}/revoke`,
        { method: "POST" },
      )).status,
      403,
    );
    assert.equal(
      (await request(
        clerkIds.platformAdmin,
        `/platform/customers/${tenantAId}/invitations/${created.invitation.id}/revoke`,
        { method: "POST" },
      )).status,
      409,
    );
  });

  test("prevents non-owners from changing owners and always retains one owner", async () => {
    const adminDemotion = await request(clerkIds.adminA, `/tenant/members/${userId.ownerA}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "member" }),
    });
    assert.equal(adminDemotion.status, 403);

    const soleOwnerDemotion = await request(clerkIds.ownerA, `/tenant/members/${userId.ownerA}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "member" }),
    });
    assert.equal(soleOwnerDemotion.status, 409);

    const platformDemotion = await request(
      clerkIds.platformAdmin,
      `/platform/customers/${tenantBId}/members/${userId.ownerB}`,
      {
        method: "PATCH",
        body: JSON.stringify({ role: "member" }),
      },
    );
    assert.equal(platformDemotion.status, 409);

    const platformRemoval = await request(
      clerkIds.platformAdmin,
      `/platform/customers/${tenantBId}/members/${userId.ownerB}`,
      { method: "DELETE" },
    );
    assert.equal(platformRemoval.status, 409);
  });
});