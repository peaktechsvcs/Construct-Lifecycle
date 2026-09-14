import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { Server } from "node:http";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  configureRuntimeReplayGuard,
  createRuntimeNonce,
  encodeRuntimeAuthorizationClaims,
} from "../src/middlewares/runtimeContext.ts";

process.env.APP_ENV = "test";

const {
  db,
  featureFeedbackVotesTable,
  platformFeatureFlagsTable,
  pool,
  tenantsTable,
  usersTable,
} = await import("@workspace/db");

type Json = Record<string, unknown> | unknown[];
type Feature = {
  key: string;
  enabled?: boolean;
  voteCount?: number;
  votedByCurrentUser?: boolean;
};

const runId = `${Date.now()}-${process.pid}`;
const featureKeys = ["contracts", "milestones"] as const;
const clerkIds = {
  platformAdmin: `feature-platform-admin-${runId}`,
  memberA: `feature-member-a-${runId}`,
  viewerA: `feature-viewer-a-${runId}`,
  concurrentA: `feature-concurrent-a-${runId}`,
  memberB: `feature-member-b-${runId}`,
};

let server: Server;
let baseUrl = "";
let tenantAId: number;
let tenantBId: number;
let userIds: number[] = [];
let userIdByClerkId = new Map<string, number>();
let originalFlags: Array<typeof platformFeatureFlagsTable.$inferSelect> = [];

async function request(
  clerkUserId: string,
  path: string,
  init: RequestInit = {},
) {
  const tenantId = clerkUserId === clerkIds.memberB ? tenantBId : tenantAId;
  const environmentId = tenantId === tenantAId ? 1 : 2;
  process.env.RUNTIME_TENANT_ID = String(tenantId);
  process.env.RUNTIME_ENVIRONMENT_ID = String(environmentId);
  const claims = encodeRuntimeAuthorizationClaims({
    role: clerkUserId === clerkIds.platformAdmin ? "platform_admin" : "member",
    permissions: ["workspace:read", "workspace:write", "workspace:admin"],
  });
  const timestamp = String(Date.now());
  const nonce = createRuntimeNonce();
  const signedPath = `/api${path}`;
  const canonical = `${tenantId}.${environmentId}.${userIdByClerkId.get(clerkUserId)}.${claims}.${timestamp}.${nonce}.${init.method ?? "GET"}.${signedPath}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-runtime-hop-count": "1",
    "x-forwarded-tenant-id": String(tenantId),
    "x-forwarded-environment-id": String(environmentId),
    "x-forwarded-user-id": String(userIdByClerkId.get(clerkUserId)),
    "x-forwarded-authorization-claims": claims,
    "x-forwarded-context-timestamp": timestamp,
    "x-forwarded-context-nonce": nonce,
    "x-forwarded-context-path": signedPath,
    "x-forwarded-context-signature": createHmac("sha256", process.env.RUNTIME_FORWARDING_SIGNING_SECRET!)
      .update(canonical)
      .digest("hex"),
    ...init.headers as Record<string, string>,
  };
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Json : undefined,
  };
}

function feature(body: Json | undefined, key: string) {
  if (Array.isArray(body)) return body.find((item) => item.key === key);
  return body && typeof body === "object" && body.key === key ? body as Feature : undefined;
}

before(async () => {
  const featureControlTables = await db.execute(sql<{ tableName: string }>`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('platform_feature_flags', 'feature_feedback_votes')
    ORDER BY table_name
  `);
  assert.deepEqual(
    featureControlTables.rows.map((row) => row.tableName),
    ["feature_feedback_votes", "platform_feature_flags"],
  );

  const featureControlIndexes = await db.execute(sql<{ indexName: string }>`
    SELECT indexname AS "indexName"
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'feature_feedback_votes_tenant_user_idx',
        'feature_feedback_votes_feature_idx'
      )
    ORDER BY indexname
  `);
  assert.deepEqual(
    featureControlIndexes.rows.map((row) => row.indexName),
    ["feature_feedback_votes_feature_idx", "feature_feedback_votes_tenant_user_idx"],
  );

  originalFlags = await db
    .select()
    .from(platformFeatureFlagsTable)
    .where(inArray(platformFeatureFlagsTable.key, [...featureKeys]));
  await db
    .delete(platformFeatureFlagsTable)
    .where(inArray(platformFeatureFlagsTable.key, [...featureKeys]));

  const [tenantA, tenantB] = await db.insert(tenantsTable).values([
    { name: `Feature Tenant A ${runId}`, slug: `feature-a-${runId}` },
    { name: `Feature Tenant B ${runId}`, slug: `feature-b-${runId}` },
  ]).returning();
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  const users = await db.insert(usersTable).values([
    {
      clerkUserId: clerkIds.platformAdmin,
      email: `${clerkIds.platformAdmin}@integration.test`,
      displayName: "Platform administrator",
      isPlatformAdmin: true,
    },
    {
      clerkUserId: clerkIds.memberA,
      email: `${clerkIds.memberA}@integration.test`,
      displayName: "Tenant A member",
    },
    {
      clerkUserId: clerkIds.viewerA,
      email: `${clerkIds.viewerA}@integration.test`,
      displayName: "Tenant A second voter",
    },
    {
      clerkUserId: clerkIds.concurrentA,
      email: `${clerkIds.concurrentA}@integration.test`,
      displayName: "Tenant A concurrent voter",
    },
    {
      clerkUserId: clerkIds.memberB,
      email: `${clerkIds.memberB}@integration.test`,
      displayName: "Tenant B member",
    },
  ]).returning();
  userIds = users.map((user) => user.id);
  userIdByClerkId = new Map(users.map((user) => [user.clerkUserId, user.id]));

  process.env.RUNTIME_ENVIRONMENT_ID = "1";
  process.env.RUNTIME_TENANT_ID = String(tenantAId);
  process.env.RUNTIME_DATABASE_URL = `${process.env.DATABASE_URL}?application_name=feature_feedback_runtime`;
  process.env.RUNTIME_FORWARDING_SIGNING_SECRET = `feature-feedback-secret-${runId}`;
  process.env.RUNTIME_REPLAY_GUARD_MODE = "single-process";
  configureRuntimeReplayGuard();
  const { default: app } = await import("../src/app.ts");

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
  if (userIds.length > 0) await db.delete(usersTable).where(inArray(usersTable.id, userIds));

  await db
    .delete(platformFeatureFlagsTable)
    .where(inArray(platformFeatureFlagsTable.key, [...featureKeys]));
  if (originalFlags.length > 0) {
    await db.insert(platformFeatureFlagsTable).values(originalFlags);
  }
  await pool.end();
});

describe("feature visibility and roadmap feedback integration", { concurrency: false }, () => {
  test("only platform administrators can toggle flags and tenants see the refreshed state", async () => {
    const denied = await request(clerkIds.memberA, "/platform/features/contracts", {
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(denied.status, 403);

    const hidden = await request(clerkIds.memberA, "/features");
    assert.equal(hidden.status, 200);
    assert.equal(feature(hidden.body, "contracts"), undefined);

    const enabled = await request(clerkIds.platformAdmin, "/platform/features/contracts", {
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(enabled.status, 200);
    assert.equal(feature(enabled.body, "contracts")?.enabled, true);

    const refreshed = await request(clerkIds.memberA, "/features");
    assert.equal(refreshed.status, 200);
    assert.equal(feature(refreshed.body, "contracts")?.enabled, true);

    const disabledAgain = await request(clerkIds.platformAdmin, "/platform/features/contracts", {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(disabledAgain.status, 200);
  });

  test("each tenant user has one replaceable vote and counts aggregate across tenants", async () => {
    const beforeVoting = await request(clerkIds.memberA, "/feedback/features");
    assert.equal(beforeVoting.status, 200);
    assert.equal(feature(beforeVoting.body, "contracts")?.voteCount, 0);

    const firstVote = await request(clerkIds.memberA, "/feedback/vote", {
      method: "POST",
      body: JSON.stringify({ featureKey: "contracts" }),
    });
    assert.equal(firstVote.status, 200);
    assert.equal(feature(firstVote.body, "contracts")?.voteCount, 1);
    assert.equal(feature(firstVote.body, "contracts")?.votedByCurrentUser, true);

    const changedVote = await request(clerkIds.memberA, "/feedback/vote", {
      method: "POST",
      body: JSON.stringify({ featureKey: "milestones" }),
    });
    assert.equal(changedVote.status, 200);
    assert.equal(feature(changedVote.body, "contracts")?.voteCount, 0);
    assert.equal(feature(changedVote.body, "milestones")?.voteCount, 1);
    assert.equal(feature(changedVote.body, "milestones")?.votedByCurrentUser, true);

    const secondUserVote = await request(clerkIds.viewerA, "/feedback/vote", {
      method: "POST",
      body: JSON.stringify({ featureKey: "contracts" }),
    });
    assert.equal(secondUserVote.status, 200);

    const otherTenantVote = await request(clerkIds.memberB, "/feedback/vote", {
      method: "POST",
      body: JSON.stringify({ featureKey: "contracts" }),
    });
    assert.equal(otherTenantVote.status, 200);

    const tenantAFeedback = await request(clerkIds.memberA, "/feedback/features");
    assert.equal(feature(tenantAFeedback.body, "contracts")?.voteCount, 2);
    assert.equal(feature(tenantAFeedback.body, "milestones")?.voteCount, 1);
    assert.equal(feature(tenantAFeedback.body, "milestones")?.votedByCurrentUser, true);
    assert.equal(feature(tenantAFeedback.body, "contracts")?.votedByCurrentUser, false);

    const tenantBFeedback = await request(clerkIds.memberB, "/feedback/features");
    assert.equal(feature(tenantBFeedback.body, "contracts")?.voteCount, 2);
    assert.equal(feature(tenantBFeedback.body, "contracts")?.votedByCurrentUser, true);

    const activeVotes = await db
      .select()
      .from(featureFeedbackVotesTable)
      .where(and(
        inArray(featureFeedbackVotesTable.tenantId, [tenantAId, tenantBId]),
        inArray(featureFeedbackVotesTable.userId, userIds),
      ));
    assert.equal(activeVotes.length, 3);
    assert.equal(new Set(activeVotes.map((vote) => `${vote.tenantId}:${vote.userId}`)).size, 3);
  });

  test("concurrent replacement votes leave one winning row and correct aggregate counts", async () => {
    const [contractsVote, milestonesVote] = await Promise.all([
      request(clerkIds.concurrentA, "/feedback/vote", {
        method: "POST",
        body: JSON.stringify({ featureKey: "contracts" }),
      }),
      request(clerkIds.concurrentA, "/feedback/vote", {
        method: "POST",
        body: JSON.stringify({ featureKey: "milestones" }),
      }),
    ]);

    assert.equal(contractsVote.status, 200, JSON.stringify(contractsVote.body));
    assert.equal(milestonesVote.status, 200, JSON.stringify(milestonesVote.body));

    const concurrentUserId = userIdByClerkId.get(clerkIds.concurrentA)!;
    const [winningVote] = await db
      .select()
      .from(featureFeedbackVotesTable)
      .where(and(
        eq(featureFeedbackVotesTable.tenantId, tenantAId),
        eq(featureFeedbackVotesTable.userId, concurrentUserId),
      ));
    assert.ok(winningVote);
    assert.ok(featureKeys.includes(winningVote.featureKey as typeof featureKeys[number]));

    const activeVotes = await db
      .select()
      .from(featureFeedbackVotesTable)
      .where(inArray(featureFeedbackVotesTable.tenantId, [tenantAId, tenantBId]));
    assert.equal(
      activeVotes.filter((vote) => vote.tenantId === tenantAId && vote.userId === concurrentUserId).length,
      1,
    );

    const counts = new Map<string, number>();
    for (const vote of activeVotes) {
      counts.set(vote.featureKey, (counts.get(vote.featureKey) ?? 0) + 1);
    }
    const feedback = await request(clerkIds.concurrentA, "/feedback/features");
    assert.equal(feedback.status, 200, JSON.stringify(feedback.body));
    for (const featureKey of featureKeys) {
      assert.equal(feature(feedback.body, featureKey)?.voteCount, counts.get(featureKey) ?? 0);
    }
    assert.equal(feature(feedback.body, winningVote.featureKey)?.votedByCurrentUser, true);
  });
});