import { spawnSync } from "node:child_process";

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
  process.exit(result.status || 1);
}

const advisories = Object.values(report.advisories ?? {});
const vulnerabilities = report.metadata?.vulnerabilities ?? {};
const total = Object.values(vulnerabilities).reduce(
  (count, value) => count + Number(value || 0),
  0,
);

if (total === 0 && advisories.length === 0) {
  const dependencyCount = report.metadata?.totalDependencies ?? "unknown";
  console.log(`Dependency audit passed: ${dependencyCount} dependencies, 0 vulnerabilities.`);
  process.exit(0);
}

console.error(`Dependency audit failed: ${total} vulnerabilities reported.`);
for (const advisory of advisories) {
  const via = (advisory.via ?? [])
    .map((entry) => typeof entry === "string" ? entry : entry.title ?? entry.source ?? "advisory")
    .join(", ");
  console.error(
    `- ${advisory.module_name ?? "unknown package"}: ${advisory.severity ?? "unknown"}`
    + `${advisory.vulnerable_versions ? ` (${advisory.vulnerable_versions})` : ""}`
    + `${via ? ` — ${via}` : ""}`,
  );
}
process.exit(1);