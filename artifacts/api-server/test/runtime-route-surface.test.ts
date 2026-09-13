import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("runtime mode route surface excludes Stripe, Clerk, and control-plane mounts", async () => {
  const appSource = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
  const routesSource = await readFile(new URL("../src/routes/index.ts", import.meta.url), "utf8");
  assert.match(appSource, /if \(!isRuntimeMode\) \{\s*app\.post\(\s*"\/api\/stripe\/webhook"/);
  assert.match(appSource, /if \(!process\.env\.RUNTIME_ENVIRONMENT_ID\) \{\s*const \[\{ clerkMiddleware \}/);
  assert.match(routesSource, /if \(process\.env\.RUNTIME_ENVIRONMENT_ID\) \{/);
  assert.match(routesSource, /router\.use\(requireSignedRuntimeContext\)/);
  const runtimeBranch = routesSource.split("if (process.env.RUNTIME_ENVIRONMENT_ID) {", 2)[1]?.split("} else {", 1)[0] ?? "";
  assert.doesNotMatch(runtimeBranch, /platformRouter|platformProvisioningRouter|billingRouter|tenantRouter|invitationTokenRouter/);
});