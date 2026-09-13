import assert from "node:assert/strict";
import test from "node:test";
import { requireRole } from "../src/middlewares/rbac.ts";

function request(role: string | undefined) {
  let statusCode = 200;
  let nextCalled = false;
  const req = {
    runtimeEnvironmentId: 22,
    runtimeRole: role,
    localUserId: 9,
    tenantId: 7,
  } as never;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json() { return this; },
  } as never;
  return requireRole("owner", "admin")(req, res, () => { nextCalled = true; })
    .then(() => ({ statusCode, nextCalled }));
}

test("runtime RBAC uses signed role claims and never falls back to environment-local memberships", async () => {
  assert.deepEqual(await request("admin"), { statusCode: 200, nextCalled: true });
  assert.deepEqual(await request("member"), { statusCode: 403, nextCalled: false });
  assert.deepEqual(await request(undefined), { statusCode: 403, nextCalled: false });
});