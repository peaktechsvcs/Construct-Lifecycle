import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  HttpProvisioningProvider,
  ProvisioningProviderRequestError,
  ProvisioningProviderUnavailableError,
  createProvisioningProviderFromEnv,
} from "../src/lib/provisioning.ts";

test("missing provider configuration is an explicit failure", async () => {
  const provider = createProvisioningProviderFromEnv({});
  await assert.rejects(
    provider.provisionResource({
      tenantId: 1,
      environmentId: 2,
      resourceType: "runtime",
      idempotencyKey: "missing-provider",
    }),
    (error: unknown) => error instanceof ProvisioningProviderUnavailableError,
  );
});

test("provider HTTP requires explicit local-only opt-in and never permits it in production", () => {
  assert.throws(() => new HttpProvisioningProvider({
    baseUrl: "http://127.0.0.1:1234",
    token: "test-token",
  }), /must use HTTPS/);
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => new HttpProvisioningProvider({
      baseUrl: "http://127.0.0.1:1234",
      token: "test-token",
      allowInsecureHttp: true,
      localOnly: true,
    }), /must use HTTPS/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("HTTP provider failures remain explicit", async (t) => {
  const server = createServer((_req, res) => {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: "provider unavailable" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const provider = new HttpProvisioningProvider({
    baseUrl: `http://127.0.0.1:${address.port}`,
    token: "test-token",
    allowInsecureHttp: true,
    localOnly: true,
  });
  await assert.rejects(
    provider.provisionResource({
      tenantId: 1,
      environmentId: 2,
      resourceType: "database",
      idempotencyKey: "failed-key",
    }),
    (error: unknown) => error instanceof ProvisioningProviderRequestError &&
      error.status === 503 &&
      error.message === "provider unavailable",
  );
});

test("HTTP provisioning provider sends authenticated idempotent operations", async (t) => {
  const requests: { path: string; authorization?: string; idempotency?: string }[] = [];
  const server = createServer(async (req, res) => {
    requests.push({
      path: req.url ?? "",
      authorization: req.headers.authorization,
      idempotency: req.headers["idempotency-key"] as string | undefined,
    });
    res.setHeader("content-type", "application/json");
    if (req.url?.includes("verify")) {
      res.end(JSON.stringify({ verified: true }));
      return;
    }
    if (req.url?.includes("restore")) {
      res.end(JSON.stringify({ providerOperationId: "restore-1" }));
      return;
    }
    if (req.url?.includes("runtime-signing-keys")) {
      res.end(JSON.stringify({ signingKey: "a".repeat(32) }));
      return;
    }
    res.end(JSON.stringify({
      externalId: "runtime-1",
      endpoint: "https://runtime.example.test",
      checksum: "sha256:abc",
      backupReference: "backup-1",
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const provider = new HttpProvisioningProvider({
    baseUrl: `http://127.0.0.1:${address.port}`,
    token: "test-token",
    allowInsecureHttp: true,
    localOnly: true,
  });
  const resource = await provider.provisionResource({
    tenantId: 1,
    environmentId: 2,
    resourceType: "runtime",
    idempotencyKey: "same-key",
  });
  assert.equal(resource.externalId, "runtime-1");
  await provider.verifyResource({
    tenantId: 1,
    environmentId: 2,
    resourceType: "runtime",
    idempotencyKey: "verify-key",
    externalId: "runtime-1",
  });
  assert.equal(await provider.resolveRuntimeSigningKey({
    tenantId: 1,
    environmentId: 2,
    keyReference: "key-ref-2",
  }), "a".repeat(32));
  const snapshot = await provider.createSnapshot({
    tenantId: 1,
    sourceEnvironmentId: 2,
    targetEnvironmentId: 2,
    sanitized: false,
    idempotencyKey: "snapshot-key",
  });
  await provider.verifySnapshot({
    tenantId: 1,
    environmentId: 2,
    backupReference: snapshot.backupReference,
    checksum: snapshot.checksum,
    idempotencyKey: "snapshot-verify-key",
  });
  await provider.restoreSnapshot({
    tenantId: 1,
    targetEnvironmentId: 2,
    backupReference: snapshot.backupReference,
    idempotencyKey: "snapshot-restore-key",
  });
  assert.equal(requests[0]?.authorization, "Bearer test-token");
  assert.equal(requests[0]?.idempotency, "same-key");
  assert.deepEqual(requests.map((request) => request.path), [
    "/v1/resources",
    "/v1/resources/runtime-1/verify",
    "/v1/runtime-signing-keys/resolve",
    "/v1/snapshots",
    "/v1/snapshots/verify",
    "/v1/snapshots/restore",
  ]);
});

test("provider rejects a successful HTTP response that is not verified", async (t) => {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ verified: false, healthy: false }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const provider = new HttpProvisioningProvider({
    baseUrl: `http://127.0.0.1:${address.port}`,
    token: "test-token",
    allowInsecureHttp: true,
    localOnly: true,
  });
  await assert.rejects(provider.verifyResource({
    tenantId: 1,
    environmentId: 2,
    resourceType: "runtime",
    externalId: "runtime-1",
    idempotencyKey: "negative-verification",
  }), /unverified result/);
  await assert.rejects(provider.verifySnapshot({
    tenantId: 1,
    environmentId: 2,
    backupReference: "backup-1",
    checksum: "checksum",
    idempotencyKey: "negative-snapshot-verification",
  }), /unverified result/);
});

test("provider exposes pending restore operations and verifies the restored target", async (t) => {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? "");
    res.setHeader("content-type", "application/json");
    if (req.url?.endsWith("/restore/status")) {
      res.end(JSON.stringify({ providerOperationId: "restore-async", status: "pending" }));
      return;
    }
    if (req.url?.endsWith("/restore/verify")) {
      res.end(JSON.stringify({ verified: true }));
      return;
    }
    res.end(JSON.stringify({ providerOperationId: "restore-async", status: "pending" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const provider = new HttpProvisioningProvider({
    baseUrl: `http://127.0.0.1:${address.port}`,
    token: "test-token",
    allowInsecureHttp: true,
    localOnly: true,
  });
  const operation = await provider.restoreSnapshot({
    tenantId: 1,
    targetEnvironmentId: 2,
    backupReference: "backup-1",
    idempotencyKey: "restore-async-key",
  });
  assert.deepEqual(operation, { providerOperationId: "restore-async", status: "pending" });
  assert.deepEqual(await provider.getRestoreOperation({
    tenantId: 1,
    targetEnvironmentId: 2,
    providerOperationId: operation.providerOperationId,
  }), { providerOperationId: "restore-async", status: "pending" });
  assert.deepEqual(await provider.verifyRestoredTarget({
    tenantId: 1,
    targetEnvironmentId: 2,
    providerOperationId: operation.providerOperationId,
  }), { verified: true });
  assert.deepEqual(requests, [
    "/v1/snapshots/restore",
    "/v1/snapshots/restore/status",
    "/v1/snapshots/restore/verify",
  ]);
});