import assert from "node:assert/strict";
import test from "node:test";
import { entitledFeatures } from "../src/lib/feature-catalog.ts";

const keysFor = (businessTypes: Parameters<typeof entitledFeatures>[0]) =>
  new Set(entitledFeatures(businessTypes).map((feature) => feature.key));

test("general contractor entitlement includes project controls but not supplier catalog features", () => {
  const keys = keysFor(["general-contractor"]);
  assert.equal(keys.has("contracts"), true);
  assert.equal(keys.has("commitments"), true);
  assert.equal(keys.has("products"), false);
  assert.equal(keys.has("receiving"), true);
});

test("supplier entitlement includes catalog and fulfillment features but not GC cost controls", () => {
  const keys = keysFor(["supplier"]);
  assert.equal(keys.has("products"), true);
  assert.equal(keys.has("purchase-orders"), true);
  assert.equal(keys.has("deliveries"), true);
  assert.equal(keys.has("commitments"), false);
  assert.equal(keys.has("margin"), false);
});

test("mixed tenants receive the union of selected business capabilities", () => {
  const keys = keysFor(["general-contractor", "subcontractor", "supplier"]);
  assert.equal(keys.has("products"), true);
  assert.equal(keys.has("contracts"), true);
  assert.equal(keys.has("change-orders"), true);
  assert.equal(keys.has("receiving"), true);
});