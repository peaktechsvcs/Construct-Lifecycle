import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { createCustomerWorkspace } from "../src/lib/customer-onboarding.ts";

const { db, pool, tenantsTable } = await import("@workspace/db");
const slug = `onboarding-rollback-${Date.now()}-${process.pid}`;

after(async () => {
  await db.delete(tenantsTable).where(eq(tenantsTable.slug, slug));
  await pool.end();
});

test("rolls back the workspace when default workflow initialization fails", async () => {
  await assert.rejects(
    createCustomerWorkspace(
      {
        name: "Workflow Failure Customer",
        slug,
        businessTypes: ["general-contractor"],
      },
      undefined,
      async () => {
        throw new Error("simulated default workflow failure");
      },
    ),
    /simulated default workflow failure/,
  );

  const [tenant] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, slug))
    .limit(1);
  assert.equal(tenant, undefined);
});