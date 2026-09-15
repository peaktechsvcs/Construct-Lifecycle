import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ALLOWLIST_URL = new URL("../config/dependency-audit-allowlist.json", import.meta.url);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function advisoryId(advisory, reportKey) {
  const value = advisory.github_advisory_id ?? advisory.id ?? advisory.source ?? reportKey;
  return value === undefined || value === null ? undefined : String(value);
}

function validExpiration(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function evaluateDependencyAudit(report, allowlist, now = new Date()) {
  const errors = [];
  const accepted = [];
  const unaccepted = [];
  const advisoryEntries = Object.entries(report?.advisories ?? {}).map(([key, advisory]) => ({
    ...advisory,
    auditAdvisoryId: advisoryId(advisory, key),
  }));
  const exceptions = allowlist?.exceptions;

  if (!allowlist || typeof allowlist !== "object" || Array.isArray(allowlist) || !Array.isArray(exceptions)) {
    return {
      errors: ["Allowlist must be an object with an exceptions array."],
      accepted,
      unaccepted: advisoryEntries,
      advisoryEntries,
    };
  }

  const exceptionByKey = new Map();
  for (const [index, exception] of exceptions.entries()) {
    const label = `Exception ${index + 1}`;
    if (!exception || typeof exception !== "object" || Array.isArray(exception)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    const packageName = typeof exception.package === "string" ? exception.package.trim() : "";
    const advisory = typeof exception.advisory === "string" ? exception.advisory.trim() : "";
    const reason = typeof exception.reason === "string" ? exception.reason.trim() : "";
    const owner = typeof exception.owner === "string" ? exception.owner.trim() : "";
    if (!packageName) errors.push(`${label} requires a package.`);
    if (!advisory) errors.push(`${label} requires an advisory.`);
    if (!reason) errors.push(`${label} requires a reason.`);
    if (!owner) errors.push(`${label} requires an owner.`);
    if (!validExpiration(exception.expires)) {
      errors.push(`${label} requires a real expiration date in YYYY-MM-DD format.`);
    }
    if (!packageName || !advisory) continue;
    const key = `${packageName}\u0000${advisory}`;
    if (exceptionByKey.has(key)) {
      errors.push(`${label} duplicates the exception for ${packageName} / ${advisory}.`);
      continue;
    }
    exceptionByKey.set(key, { ...exception, package: packageName, advisory, reason, owner });
    if (validExpiration(exception.expires)) {
      const expiresAt = new Date(`${exception.expires}T23:59:59.999Z`);
      if (now.getTime() > expiresAt.getTime()) {
        errors.push(`${label} for ${packageName} / ${advisory} expired on ${exception.expires}.`);
      }
    }
  }

  const matchedKeys = new Set();
  for (const advisory of advisoryEntries) {
    const packageName = typeof advisory.module_name === "string" ? advisory.module_name : "";
    const id = advisory.auditAdvisoryId;
    const key = id ? `${packageName}\u0000${id}` : undefined;
    const exception = key ? exceptionByKey.get(key) : undefined;
    if (exception) {
      matchedKeys.add(key);
      accepted.push({ advisory, exception });
    } else {
      unaccepted.push(advisory);
    }
  }

  for (const [key, exception] of exceptionByKey) {
    if (!matchedKeys.has(key)) {
      errors.push(
        `Exception for ${exception.package} / ${exception.advisory} no longer matches a reported advisory; remove or update it.`,
      );
    }
  }

  const vulnerabilityCounts = report?.metadata?.vulnerabilities ?? {};
  const reportedTotal = Number.isFinite(Number(vulnerabilityCounts.total))
    ? Number(vulnerabilityCounts.total)
    : Object.entries(vulnerabilityCounts).reduce(
      (count, [severity, value]) => severity === "total" ? count : count + Number(value || 0),
      0,
    );
  if (reportedTotal > 0 && advisoryEntries.length === 0) {
    errors.push(
      `Audit metadata reports ${reportedTotal} vulnerabilities but only ${advisoryEntries.length} advisories were identifiable.`,
    );
  }

  return { errors, accepted, unaccepted, advisoryEntries, reportedTotal };
}

function describeAdvisory(advisory) {
  const via = (advisory.via ?? [])
    .map((entry) => typeof entry === "string" ? entry : entry.title ?? entry.source ?? "advisory")
    .join(", ");
  return `${advisory.module_name ?? "unknown package"} / ${advisory.auditAdvisoryId ?? "unknown advisory"}`
    + `: ${advisory.severity ?? "unknown"}`
    + `${advisory.vulnerable_versions ? ` (${advisory.vulnerable_versions})` : ""}`
    + `${via ? ` — ${via}` : ""}`;
}

export function runDependencyAudit({
  allowlistPath = fileURLToPath(DEFAULT_ALLOWLIST_URL),
  now = new Date(),
} = {}) {
  let allowlist;
  try {
    allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
  } catch (error) {
    console.error(`Dependency audit policy failed: could not read ${allowlistPath}: ${error.message}`);
    return 1;
  }

  const result = spawnSync("pnpm", ["audit", "--json"], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}`.trim();
  let report;
  try {
    report = JSON.parse(output);
  } catch {
    process.stderr.write(result.stderr || output || "pnpm audit returned no report.\n");
    return result.status || 1;
  }

  const evaluation = evaluateDependencyAudit(report, allowlist, now);
  for (const item of evaluation.accepted) {
    console.warn(
      `Dependency audit exception accepted: ${describeAdvisory(item.advisory)}`
      + ` — owner: ${item.exception.owner}; expires: ${item.exception.expires}; reason: ${item.exception.reason}`,
    );
  }
  for (const advisory of evaluation.unaccepted) {
    console.error(`Unaccepted dependency vulnerability: ${describeAdvisory(advisory)}`);
  }
  for (const error of evaluation.errors) console.error(`Dependency audit policy error: ${error}`);

  if (evaluation.unaccepted.length || evaluation.errors.length) {
    console.error(
      `Dependency audit failed: ${evaluation.unaccepted.length} unaccepted vulnerabilities,`
      + ` ${evaluation.errors.length} policy errors.`,
    );
    return 1;
  }
  if (evaluation.accepted.length) {
    console.log(`Dependency audit passed with ${evaluation.accepted.length} temporary reviewed exception(s).`);
    return 0;
  }
  const dependencyCount = report.metadata?.totalDependencies ?? "unknown";
  console.log(`Dependency audit passed: ${dependencyCount} dependencies, 0 vulnerabilities.`);
  return 0;
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exit(runDependencyAudit());