import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePayApplicationAmounts,
  canReviewCompliance,
  evaluateComplianceGate,
  scopeMatches,
} from "../src/lib/subcontractor-compliance-policy.ts";

test("compliance scope requires both tenant and environment identity", () => {
  assert.equal(scopeMatches({ tenantId: 10, environmentId: 20 }, { tenantId: 10, environmentId: 20 }), true);
  assert.equal(scopeMatches({ tenantId: 10, environmentId: 20 }, { tenantId: 10, environmentId: 21 }), false);
  assert.equal(scopeMatches({ tenantId: 10, environmentId: 20 }, { tenantId: 11, environmentId: 20 }), false);
});

test("missing and expired compliance blocks the requested gate", () => {
  const missing = evaluateComplianceGate({
    qualificationStatus: "approved",
    documents: [],
    requirements: [{
      title: "Current insurance certificate",
      status: "open",
      blocksAward: true,
      blocksMobilization: false,
      blocksBilling: false,
      blocksCloseout: false,
    }],
    gate: "award",
  });
  assert.deepEqual(missing, { allowed: false, blockers: ["Current insurance certificate"] });

  const expired = evaluateComplianceGate({
    qualificationStatus: "approved",
    documents: [{ status: "approved", expiresOn: "2025-01-01" }],
    requirements: [],
    gate: "billing",
  });
  assert.equal(expired.allowed, false);
  assert.match(expired.blockers[0] ?? "", /expired/);
});

test("qualification approval and status transitions are restricted to administrators", () => {
  assert.equal(canReviewCompliance("owner"), true);
  assert.equal(canReviewCompliance("admin"), true);
  assert.equal(canReviewCompliance("member"), false);
  assert.equal(canReviewCompliance(undefined), false);
});

test("pay applications calculate retainage and never return a negative net amount", () => {
  assert.deepEqual(calculatePayApplicationAmounts(100000, 10000), {
    grossAmount: 100000,
    retainageAmount: 10000,
    netAmount: 90000,
  });
  assert.equal(calculatePayApplicationAmounts(1000, 1500).netAmount, 0);
  assert.throws(() => calculatePayApplicationAmounts(-1, 0), /non-negative/);
});