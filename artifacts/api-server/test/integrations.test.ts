import assert from "node:assert/strict";
import test from "node:test";
import {
  managedCredentialsReference,
  selectManagedConnection,
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