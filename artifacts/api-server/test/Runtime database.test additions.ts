// Append to the existing runtime context test file.
// Add resolveDirectDatabaseUrl to the import from ../../../lib/db/src/runtime-database.ts

const POOLED = "postgresql://u:p@ep-cool-rain-b4uatre4-pooler.c-6.us-east-2.aws.neon.tech/neondb";
const DIRECT = "postgresql://u:p@ep-cool-rain-b4uatre4.c-6.us-east-2.aws.neon.tech/neondb";

test("direct database url prefers the explicit direct connection", () => {
  assert.equal(resolveDirectDatabaseUrl({
    DATABASE_URL: POOLED,
    DIRECT_URL: DIRECT,
  }), DIRECT);
});

test("direct database url falls back to a non-pooled DATABASE_URL", () => {
  assert.equal(resolveDirectDatabaseUrl({
    DATABASE_URL: "postgres://control-plane",
  }), "postgres://control-plane");
  assert.equal(resolveDirectDatabaseUrl({
    DATABASE_URL: DIRECT,
  }), DIRECT);
});

test("direct database url refuses to fall back to a pooled endpoint", () => {
  assert.throws(() => resolveDirectDatabaseUrl({
    DATABASE_URL: POOLED,
  }), /DIRECT_URL is not set/);
  assert.throws(() => resolveDirectDatabaseUrl({
    RUNTIME_ENVIRONMENT_ID: "22",
    RUNTIME_DATABASE_URL: POOLED,
  }), /RUNTIME_DIRECT_URL is not set/);
});

test("direct database url honours the runtime identity pairing", () => {
  assert.equal(resolveDirectDatabaseUrl({
    DATABASE_URL: DIRECT,
    RUNTIME_ENVIRONMENT_ID: "22",
    RUNTIME_DATABASE_URL: "postgres://isolated-runtime",
    RUNTIME_DIRECT_URL: "postgres://isolated-runtime-direct",
  }), "postgres://isolated-runtime-direct");

  assert.equal(resolveDirectDatabaseUrl({
    DATABASE_URL: DIRECT,
    RUNTIME_ENVIRONMENT_ID: "22",
    RUNTIME_DATABASE_URL: "postgres://isolated-runtime",
  }), "postgres://isolated-runtime");

  assert.throws(() => resolveDirectDatabaseUrl({
    DATABASE_URL: DIRECT,
    RUNTIME_DIRECT_URL: "postgres://isolated-runtime-direct",
  }), /RUNTIME_DIRECT_URL cannot be set without RUNTIME_ENVIRONMENT_ID/);

  assert.throws(() => resolveDirectDatabaseUrl({
    DATABASE_URL: DIRECT,
    RUNTIME_ENVIRONMENT_ID: "22",
  }), /RUNTIME_ENVIRONMENT_ID requires RUNTIME_DATABASE_URL/);
});