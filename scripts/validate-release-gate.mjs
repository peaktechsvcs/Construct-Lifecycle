import { chmod, mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`Release gate validation failed: ${message}`);
  process.exitCode = 1;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function validateWiring() {
  const [replit, packageJson] = await Promise.all([
    readFile(path.join(root, ".replit"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
  ]);
  const packageData = JSON.parse(packageJson);
  const postBuild = replit.match(/\[deployment\.postBuild\]([\s\S]*?)(?=\n\[|\n\[\[|$)/)?.[1] ?? "";
  const postBuildArgs = postBuild.match(/args\s*=\s*\[([^\]]+)\]/)?.[1] ?? "";
  const releaseCommand = packageData.scripts?.["release:verify"];

  if (!/"pnpm"\s*,\s*"run"\s*,\s*"release:verify"/.test(postBuildArgs)) {
    throw new Error("deployment.postBuild must invoke pnpm run release:verify");
  }
  if (typeof releaseCommand !== "string" || !releaseCommand.includes("pnpm run audit:dependencies")) {
    throw new Error("release:verify must invoke pnpm run audit:dependencies");
  }
  if (!releaseCommand.includes("pnpm store prune")) {
    throw new Error("release:verify must retain pnpm store cleanup after verification");
  }
}

async function validateFailurePropagation() {
  const pnpmLookup = spawnSync("sh", ["-c", "command -v pnpm"], {
    cwd: root,
    encoding: "utf8",
  });
  const realPnpm = pnpmLookup.stdout.trim();
  if (pnpmLookup.status !== 0 || !realPnpm) {
    throw new Error("could not locate pnpm for the synthetic release verification");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "release-gate-"));
  const binDir = path.join(tempDir, "bin");
  const reportPath = path.join(tempDir, "audit-report.json");
  const cleanupMarker = path.join(tempDir, "store-prune-called");
  const fakePnpmPath = path.join(binDir, "pnpm");
  const report = {
    advisories: {
      "synthetic-1": {
        id: "synthetic-1",
        module_name: "synthetic-vulnerable-package",
        severity: "high",
        vulnerable_versions: "<2.0.0",
        via: [{ title: "Synthetic release-gate vulnerability" }],
      },
    },
    metadata: {
      totalDependencies: 1,
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
    },
  };

  try {
    await mkdir(binDir);
    await writeFile(reportPath, JSON.stringify(report));
    await writeFile(
      fakePnpmPath,
      `#!/bin/sh
if [ "$1" = "audit" ] && [ "$2" = "--json" ]; then
  cat ${shellQuote(reportPath)}
  exit 0
fi
if [ "$1" = "store" ] && [ "$2" = "prune" ]; then
  touch ${shellQuote(cleanupMarker)}
fi
exec ${shellQuote(realPnpm)} "$@"
`,
    );
    await chmod(fakePnpmPath, 0o755);

    const result = spawnSync(realPnpm, ["run", "release:verify"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        RELEASE_GATE_VALIDATION: "1",
      },
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    if (result.status === 0) {
      throw new Error("release:verify accepted the synthetic vulnerable audit");
    }
    if (!output.includes("synthetic-vulnerable-package") || !/\bhigh\b/i.test(output)) {
      throw new Error("release:verify did not report the affected package and high severity");
    }
    if (await fileExists(cleanupMarker)) {
      throw new Error("release:verify pruned the pnpm store after the failed audit");
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function fileExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

if (process.env.RELEASE_GATE_VALIDATION === "1") {
  console.log("Nested release-gate wiring validation skipped.");
} else {
  try {
    await validateWiring();
    await validateFailurePropagation();
    console.log("Release gate validation passed.");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}