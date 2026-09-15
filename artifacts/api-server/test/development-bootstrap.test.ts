import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldBootstrapDefaultTenant,
  shouldCreateDevelopmentEnvironment,
} from "../src/lib/development-bootstrap.ts";

test("development bootstrap repairs a platform admin created before its tenant", () => {
  assert.equal(shouldBootstrapDefaultTenant({
    appEnv: "development",
    isPlatformAdmin: true,
    hasUserMemberships: false,
    membershipCount: 0,
  }), true);
});

test("development bootstrap still seeds the first non-admin workspace", () => {
  assert.equal(shouldBootstrapDefaultTenant({
    appEnv: "development",
    isPlatformAdmin: false,
    hasUserMemberships: false,
    membershipCount: 0,
  }), true);
});

test("development bootstrap does not grant later users an implicit workspace", () => {
  assert.equal(shouldBootstrapDefaultTenant({
    appEnv: "development",
    isPlatformAdmin: false,
    hasUserMemberships: false,
    membershipCount: 1,
  }), false);
});

test("production never creates the development tenant or environment", () => {
  assert.equal(shouldBootstrapDefaultTenant({
    appEnv: "production",
    isPlatformAdmin: true,
    hasUserMemberships: false,
    membershipCount: 0,
  }), false);
  assert.equal(shouldCreateDevelopmentEnvironment({
    appEnv: "production",
    hasEnvironment: false,
  }), false);
});

test("development creates an environment only when the workspace has none", () => {
  assert.equal(shouldCreateDevelopmentEnvironment({
    appEnv: "development",
    hasEnvironment: false,
  }), true);
  assert.equal(shouldCreateDevelopmentEnvironment({
    appEnv: "development",
    hasEnvironment: true,
  }), false);
});