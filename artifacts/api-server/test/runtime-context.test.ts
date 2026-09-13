import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { resolveDatabaseUrl } from "../../../lib/db/src/runtime-database.ts";
import {
  assertRuntimeProcessConfiguration,
  configureRuntimeReplayGuard,
  encodeRuntimeAuthorizationClaims,
  requireSignedRuntimeContext,
} from "../src/middlewares/runtimeContext.ts";

test("partial runtime configuration fails closed", () => {
  assert.throws(() => assertRuntimeProcessConfiguration({
    RUNTIME_DATABASE_URL: "postgres://isolated-runtime",
  }), /Partial runtime configuration is forbidden/);
  assert.throws(() => assertRuntimeProcessConfiguration({
    RUNTIME_ENVIRONMENT_ID: "22",
    RUNTIME_DATABASE_URL: "postgres://isolated-runtime",
  }), /require RUNTIME_TENANT_ID/);
});

test("database package rejects a runtime database without runtime identity", () => {
  assert.throws(() => resolveDatabaseUrl({
    DATABASE_URL: "postgres://control-plane",
    RUNTIME_DATABASE_URL: "postgres://isolated-runtime",
  }), /RUNTIME_DATABASE_URL cannot be set without RUNTIME_ENVIRONMENT_ID/);
  assert.throws(() => resolveDatabaseUrl({
    DATABASE_URL: "postgres://control-plane",
    RUNTIME_ENVIRONMENT_ID: "22",
  }), /RUNTIME_ENVIRONMENT_ID requires RUNTIME_DATABASE_URL/);
  assert.equal(resolveDatabaseUrl({
    DATABASE_URL: "postgres://control-plane",
  }), "postgres://control-plane");
  assert.equal(resolveDatabaseUrl({
    DATABASE_URL: "postgres://control-plane",
    RUNTIME_ENVIRONMENT_ID: "22",
    RUNTIME_DATABASE_URL: "postgres://isolated-runtime",
  }), "postgres://isolated-runtime");
});

test("runtime boundary accepts only a signed, environment-bound forwarded context", async () => {
  const previous = {
    environment: process.env.RUNTIME_ENVIRONMENT_ID,
    tenant: process.env.RUNTIME_TENANT_ID,
    database: process.env.RUNTIME_DATABASE_URL,
    controlDatabase: process.env.DATABASE_URL,
    secret: process.env.RUNTIME_FORWARDING_SIGNING_SECRET,
    replayMode: process.env.RUNTIME_REPLAY_GUARD_MODE,
  };
  process.env.RUNTIME_ENVIRONMENT_ID = "22";
  process.env.RUNTIME_TENANT_ID = "7";
  process.env.RUNTIME_DATABASE_URL = "postgres://isolated-runtime";
  process.env.DATABASE_URL = "postgres://control-plane";
  process.env.RUNTIME_FORWARDING_SIGNING_SECRET = "runtime-test-secret";
  process.env.RUNTIME_REPLAY_GUARD_MODE = "single-process";
  configureRuntimeReplayGuard();
  try {
    const timestamp = String(Date.now());
    const headers: Record<string, string> = {
      "x-forwarded-tenant-id": "7",
      "x-forwarded-environment-id": "22",
      "x-forwarded-user-id": "9",
      "x-forwarded-authorization-claims": encodeRuntimeAuthorizationClaims({ role: "member", permissions: ["workspace:read", "workspace:write"] }),
      "x-forwarded-context-timestamp": timestamp,
      "x-forwarded-context-path": "/projects",
      "x-forwarded-context-nonce": "test-nonce",
      "x-runtime-hop-count": "1",
    };
    const canonical = `7.22.9.${headers["x-forwarded-authorization-claims"]}.${timestamp}.${headers["x-forwarded-context-nonce"]}.GET.${headers["x-forwarded-context-path"]}`;
    headers["x-forwarded-context-signature"] = createHmac("sha256", process.env.RUNTIME_FORWARDING_SIGNING_SECRET)
      .update(canonical).digest("hex");
    let called = false;
    const req = {
      method: "GET",
      originalUrl: "/projects",
      header(name: string) { return headers[name.toLowerCase()]; },
    } as never;
    const res = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json() { return this; },
    } as never;
    await requireSignedRuntimeContext(req, res, () => { called = true; });
    assert.equal(called, true);
  } finally {
    for (const [key, value] of Object.entries({
      RUNTIME_ENVIRONMENT_ID: previous.environment,
      RUNTIME_TENANT_ID: previous.tenant,
      RUNTIME_DATABASE_URL: previous.database,
      DATABASE_URL: previous.controlDatabase,
      RUNTIME_FORWARDING_SIGNING_SECRET: previous.secret,
      RUNTIME_REPLAY_GUARD_MODE: previous.replayMode,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("runtime signatures reject substitution, expiry, wrong environment, invalid MAC, and nonce replay", async () => {
  const previous = {
    environment: process.env.RUNTIME_ENVIRONMENT_ID,
    tenant: process.env.RUNTIME_TENANT_ID,
    database: process.env.RUNTIME_DATABASE_URL,
    controlDatabase: process.env.DATABASE_URL,
    secret: process.env.RUNTIME_FORWARDING_SIGNING_SECRET,
    replayMode: process.env.RUNTIME_REPLAY_GUARD_MODE,
  };
  process.env.RUNTIME_ENVIRONMENT_ID = "22";
  process.env.RUNTIME_TENANT_ID = "7";
  process.env.RUNTIME_DATABASE_URL = "postgres://isolated-runtime";
  process.env.DATABASE_URL = "postgres://control-plane";
  process.env.RUNTIME_FORWARDING_SIGNING_SECRET = "runtime-test-secret";
  process.env.RUNTIME_REPLAY_GUARD_MODE = "single-process";
  configureRuntimeReplayGuard();
  try {
    const run = async (overrides: Record<string, string> = {}) => {
      const timestamp = overrides.timestamp ?? String(Date.now());
      const path = overrides.path ?? "/projects?view=list";
      const nonce = overrides.nonce ?? `nonce-${Math.random()}`;
      const headers: Record<string, string> = {
        "x-forwarded-tenant-id": "7",
        "x-forwarded-environment-id": overrides.environment ?? "22",
        "x-forwarded-user-id": "9",
        "x-forwarded-authorization-claims": encodeRuntimeAuthorizationClaims({ role: "member", permissions: ["workspace:read", "workspace:write"] }),
        "x-forwarded-context-timestamp": timestamp,
        "x-forwarded-context-path": path,
        "x-forwarded-context-nonce": nonce,
        "x-runtime-hop-count": "1",
      };
      if (overrides.tenant) headers["x-forwarded-tenant-id"] = overrides.tenant;
      const canonical = `${headers["x-forwarded-tenant-id"]}.${headers["x-forwarded-environment-id"]}.9.${headers["x-forwarded-authorization-claims"]}.${timestamp}.${nonce}.GET.${path}`;
      headers["x-forwarded-context-signature"] = createHmac("sha256", overrides.signingSecret ?? process.env.RUNTIME_FORWARDING_SIGNING_SECRET!)
        .update(overrides.signature ?? canonical).digest("hex");
      let statusCode = 200;
      let body: unknown;
      const req = {
        method: "GET",
        originalUrl: overrides.actualPath ?? path,
        header(name: string) { return headers[name.toLowerCase()]; },
      } as never;
      const res = {
        status(code: number) { statusCode = code; return this; },
        json(value: unknown) { body = value; return this; },
      } as never;
      let called = false;
      await requireSignedRuntimeContext(req, res, () => { called = true; });
      return { statusCode, body, called };
    };
    assert.equal((await run({ path: "/projects?view=list", actualPath: "/projects?view=kanban" })).statusCode, 401);
    assert.equal((await run({ path: "/projects?view=list", actualPath: "/projects?view=list&extra=1" })).statusCode, 401);
    assert.equal((await run({ timestamp: String(Date.now() - 6 * 60_000) })).statusCode, 401);
    assert.equal((await run({ environment: "23" })).statusCode, 403);
    assert.equal((await run({ tenant: "8" })).statusCode, 403);
    assert.equal((await run({ signature: "wrong-signature" })).statusCode, 401);
    assert.equal((await run({ signingSecret: "environment-a-key" })).statusCode, 401);
    process.env.RUNTIME_ENVIRONMENT_ID = "23";
    process.env.RUNTIME_FORWARDING_SIGNING_SECRET = "environment-b-key";
    assert.equal((await run({ environment: "23", signingSecret: "environment-a-key" })).statusCode, 401);
    const replay = await run({ environment: "23", nonce: "reused-nonce" });
    assert.equal(replay.called, true);
    assert.equal((await run({ environment: "23", nonce: "reused-nonce" })).statusCode, 401);
  } finally {
    for (const [key, value] of Object.entries({
      RUNTIME_ENVIRONMENT_ID: previous.environment,
      RUNTIME_TENANT_ID: previous.tenant,
      RUNTIME_DATABASE_URL: previous.database,
      DATABASE_URL: previous.controlDatabase,
      RUNTIME_FORWARDING_SIGNING_SECRET: previous.secret,
      RUNTIME_REPLAY_GUARD_MODE: previous.replayMode,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});