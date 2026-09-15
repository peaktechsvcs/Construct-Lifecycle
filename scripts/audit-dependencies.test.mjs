import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDependencyAudit } from "./audit-dependencies.mjs";

const now = new Date("2026-09-14T12:00:00.000Z");
const report = {
  advisories: {
    "1100001": {
      id: 1100001,
      github_advisory_id: "GHSA-abcd-1234-wxyz",
      module_name: "affected-package",
      severity: "high",
      vulnerable_versions: "<2.0.0",
    },
  },
  metadata: {
    totalDependencies: 100,
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
  },
};

const exception = {
  package: "affected-package",
  advisory: "GHSA-abcd-1234-wxyz",
  reason: "Temporary compatibility constraint while the upstream fix is validated.",
  owner: "Security owner",
  expires: "2026-09-30",
};

test("keeps zero unaccepted vulnerabilities as the default", () => {
  const result = evaluateDependencyAudit(report, { exceptions: [] }, now);
  assert.equal(result.unaccepted.length, 1);
  assert.deepEqual(result.errors, []);
});

test("accepts an exact reviewed exception through its expiration date", () => {
  const result = evaluateDependencyAudit(report, { exceptions: [exception] }, now);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.unaccepted.length, 0);
  assert.deepEqual(result.errors, []);

  const expirationDay = evaluateDependencyAudit(
    report,
    { exceptions: [exception] },
    new Date("2026-09-30T23:59:59.999Z"),
  );
  assert.deepEqual(expirationDay.errors, []);
});

test("fails expired exceptions", () => {
  const result = evaluateDependencyAudit(
    report,
    { exceptions: [exception] },
    new Date("2026-10-01T00:00:00.000Z"),
  );
  assert.match(result.errors.join("\n"), /expired on 2026-09-30/);
});

test("fails stale, mismatched, malformed, and duplicate exceptions", () => {
  const stale = evaluateDependencyAudit(
    { advisories: {}, metadata: { vulnerabilities: {} } },
    { exceptions: [exception] },
    now,
  );
  assert.match(stale.errors.join("\n"), /no longer matches a reported advisory/);

  const wrongPackage = evaluateDependencyAudit(
    report,
    { exceptions: [{ ...exception, package: "other-package" }] },
    now,
  );
  assert.equal(wrongPackage.unaccepted.length, 1);
  assert.match(wrongPackage.errors.join("\n"), /no longer matches a reported advisory/);

  const malformed = evaluateDependencyAudit(
    report,
    { exceptions: [{ package: "", advisory: "", reason: "", owner: "", expires: "2026-02-30" }] },
    now,
  );
  assert.equal(malformed.errors.length, 5);

  const duplicate = evaluateDependencyAudit(
    report,
    { exceptions: [exception, exception] },
    now,
  );
  assert.match(duplicate.errors.join("\n"), /duplicates the exception/);
});

test("fails when audit totals cannot be mapped to identifiable advisories", () => {
  const result = evaluateDependencyAudit(
    { advisories: {}, metadata: { vulnerabilities: { high: 1 } } },
    { exceptions: [] },
    now,
  );
  assert.match(result.errors.join("\n"), /only 0 advisories were identifiable/);
});