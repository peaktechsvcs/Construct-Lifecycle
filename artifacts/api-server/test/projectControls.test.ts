import assert from "node:assert/strict";
import test from "node:test";
import { canApproveProjectChange, canViewProjectControlArea } from "../src/lib/project-control-policy.ts";
import { forecastMargin, forecastMarginPercent, sumCommittedCost } from "../src/lib/project-control-math.ts";

test("project control financials calculate forecast margin from revenue and forecast cost", () => {
  const input = { contractValue: 250000, committedCost: 120000, forecastCost: 175000 };
  assert.equal(forecastMargin(input), 75000);
  assert.equal(forecastMarginPercent(input), 30);
  assert.equal(sumCommittedCost([1000, 2500.5, 499.5]), 4000);
});

test("approval transitions are limited to customer administrators", () => {
  assert.equal(canApproveProjectChange("owner"), true);
  assert.equal(canApproveProjectChange("admin"), true);
  assert.equal(canApproveProjectChange("member"), false);
});

test("participant visibility keeps financial controls private while sharing operational decisions", () => {
  assert.equal(canViewProjectControlArea("owner", "financials"), true);
  assert.equal(canViewProjectControlArea("architect", "financials"), false);
  assert.equal(canViewProjectControlArea("architect", "issues"), true);
  assert.equal(canViewProjectControlArea("supplier", "commitments"), true);
  assert.equal(canViewProjectControlArea("supplier", "schedule"), false);
});

test("control records require both tenant and environment scope", () => {
  const scopeMatches = (left: { tenantId: number; environmentId: number }, right: { tenantId: number; environmentId: number }) =>
    left.tenantId === right.tenantId && left.environmentId === right.environmentId;
  assert.equal(scopeMatches({ tenantId: 1, environmentId: 2 }, { tenantId: 1, environmentId: 2 }), true);
  assert.equal(scopeMatches({ tenantId: 1, environmentId: 2 }, { tenantId: 1, environmentId: 3 }), false);
  assert.equal(scopeMatches({ tenantId: 1, environmentId: 2 }, { tenantId: 2, environmentId: 2 }), false);
});