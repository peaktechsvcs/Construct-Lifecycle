import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { createCustomerWorkspace } from "../src/lib/customer-onboarding.ts";
import { createPlatformCustomerHandler } from "../src/routes/platform.ts";

const { db, pool, tenantsTable } = await import("@workspace/db");
const slug = `onboarding-rollback-${Date.now()}-${process.pid}`;

after(async () => {
  await db.delete(tenantsTable).where(eq(tenantsTable.slug, slug));
  await pool.end();
});

test("returns the safe recovery message and rolls back when setup fails", async () => {
  let statusCode = 200;
  let responseBody: unknown;
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
    localUserId: undefined,
    log: { error() {} },
  };

  await createPlatformCustomerHandler(
    request as never,
    response as never,
    (input, userId) => createCustomerWorkspace(
      input,
      userId,
      async () => {
        throw new Error("simulated default workflow failure");
      },
    ),
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
});