import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionToDtdRefresh,
  assertResourceTransition,
  deriveEnvironmentProvisioningStatus,
  isRecentHealthyCheck,
  isIsolatedEnvironmentReady,
  redactProviderMetadata,
} from "../src/lib/provisioning.ts";

const resources = [
  "runtime", "database", "storage", "queue", "secrets", "jobs", "logs",
].map((resourceType) => ({ resourceType, status: "ready" }));

test("an execution context is ready only when every isolated resource is ready", () => {
  assert.equal(isIsolatedEnvironmentReady(resources), true);
  assert.equal(isIsolatedEnvironmentReady(resources.slice(1)), false);
  assert.equal(isIsolatedEnvironmentReady(resources.map((row, index) => index === 2 ? { ...row, status: "failed" } : row)), false);
});

test("resource transitions reject unsafe state changes", () => {
  assert.doesNotThrow(() => assertResourceTransition("requested", "provisioning"));
  assert.throws(() => assertResourceTransition("requested", "ready"), /Invalid environment resource transition/);
  assert.doesNotThrow(() => assertResourceTransition("failed", "provisioning"));
});

test("production-to-DTD refresh enforces customer boundary and sanitization", () => {
  assert.doesNotThrow(() => assertProductionToDtdRefresh(
    { tenantId: 7, kind: "production" },
    { tenantId: 7, kind: "dtd" },
    "redact-secrets",
  ));
  assert.throws(() => assertProductionToDtdRefresh(
    { tenantId: 7, kind: "production" },
    { tenantId: 8, kind: "dtd" },
    "full",
  ), /customer boundaries/);
  assert.throws(() => assertProductionToDtdRefresh(
    { tenantId: 7, kind: "dtd" },
    { tenantId: 7, kind: "production" },
    "full",
  ), /source must be Production/);
  assert.throws(() => assertProductionToDtdRefresh(
    { tenantId: 7, kind: "production" },
    { tenantId: 7, kind: "dtd" },
    "none",
  ), /explicit sanitization policy/);
});

test("provisioning status is derived from current resources and in-flight operations", () => {
  const ready = resources.map((resource) => ({ ...resource }));
  assert.equal(deriveEnvironmentProvisioningStatus(ready, []), "ready");
  assert.equal(deriveEnvironmentProvisioningStatus(ready, [{ status: "running" }]), "provisioning");
  assert.equal(deriveEnvironmentProvisioningStatus(
    ready.map((row, index) => index === 1 ? { ...row, status: "failed" } : row),
    [{ status: "succeeded" }],
  ), "failed");
  assert.equal(deriveEnvironmentProvisioningStatus([], []), "requested");
});

test("health gating requires a recent successful check", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(isRecentHealthyCheck({ status: "healthy", checkedAt: new Date(now - 60_000) }, now, 300_000), true);
  assert.equal(isRecentHealthyCheck({ status: "healthy", checkedAt: new Date(now - 301_000) }, now, 300_000), false);
  assert.equal(isRecentHealthyCheck({ status: "unhealthy", checkedAt: new Date(now) }, now, 300_000), false);
});

test("newer unhealthy health check overrides an older healthy check", () => {
  const checks = [
    { status: "healthy", checkedAt: new Date("2026-01-01T00:00:00.000Z") },
    { status: "unhealthy", checkedAt: new Date("2026-01-01T00:01:00.000Z") },
  ];
  const latest = [...checks].sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())[0];
  assert.equal(isRecentHealthyCheck(latest, Date.parse("2026-01-01T00:01:30.000Z"), 300_000), false);
});

test("provider metadata redaction removes nested key material", () => {
  assert.deepEqual(redactProviderMetadata({
    endpoint: "https://runtime.example.test",
    signingKey: "raw-key",
    nested: { token: "raw-token", region: "us-east-1" },
  }), {
    endpoint: "https://runtime.example.test",
    nested: { region: "us-east-1" },
  });
});