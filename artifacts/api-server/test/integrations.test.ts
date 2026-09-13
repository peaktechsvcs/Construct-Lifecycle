import assert from "node:assert/strict";
import test from "node:test";
import {
  managedCredentialsReference,
  selectManagedConnection,
  summarizeIntegrationHealth,
} from "../src/lib/integrations/managed-connection.ts";

test("selects one active managed connector authorization", () => {
  assert.deepEqual(
    selectManagedConnection([{ id: "connection-1", status: "connected" }]),
    { kind: "selected", connection: { id: "connection-1", status: "connected" } },
  );
});

test("requires a fresh authorization when the managed connector is unavailable", () => {
  assert.deepEqual(
    selectManagedConnection([
      { id: "connection-1", status: "revoked" },
      { id: "connection-2", status: "expired" },
    ]),
    { kind: "missing" },
  );
});

test("rejects ambiguous managed connector authorizations", () => {
  assert.deepEqual(
    selectManagedConnection([
      { id: "connection-1", status: "connected" },
      { id: "connection-2", status: "active" },
    ]),
    { kind: "ambiguous" },
  );
});

test("creates an opaque, provider-scoped reference without credential material", () => {
  assert.equal(
    managedCredentialsReference("google-mail", "connection-1"),
    "replit-connector:google-mail:connection-1",
  );
});

test("reports a healthy provider only after a successful sync", () => {
  const result = summarizeIntegrationHealth({
    status: "connected",
    lastSuccessfulSyncAt: new Date("2026-09-13T12:00:00Z"),
    lastSyncStatus: "success",
    lastFailureAt: null,
    lastError: null,
  }, []);

  assert.equal(result.healthStatus, "healthy");
  assert.equal(result.retryCount, 0);
  assert.equal(result.deadLetterCount, 0);
});

test("reports retry and dead-letter work as actionable degradation", () => {
  const result = summarizeIntegrationHealth({
    status: "connected",
    lastSuccessfulSyncAt: new Date("2026-09-13T12:00:00Z"),
    lastSyncStatus: "success",
    lastFailureAt: null,
    lastError: null,
  }, [
    {
      status: "retry",
      nextRetryAt: new Date("2026-09-13T12:15:00Z"),
      lastError: "Provider timeout",
      updatedAt: new Date("2026-09-13T12:10:00Z"),
    },
    {
      status: "dead_letter",
      nextRetryAt: null,
      lastError: "Invalid mailbox scope",
      updatedAt: new Date("2026-09-13T12:11:00Z"),
    },
  ]);

  assert.equal(result.healthStatus, "failed");
  assert.equal(result.retryCount, 1);
  assert.equal(result.deadLetterCount, 1);
  assert.equal(result.nextRetryAt?.toISOString(), "2026-09-13T12:15:00.000Z");
  assert.equal(result.lastError, "Invalid mailbox scope");
});