import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

globalThis.require = createRequire(import.meta.url);

const testDir = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(testDir, `.integration-dist-${process.pid}`);
const allIntegrationTests = [
  "tenant-isolation.integration.test.ts",
  "billing.integration.test.ts",
  "feature-feedback.integration.test.ts",
  "customer-onboarding.integration.test.ts",
  "invitation-rbac.integration.test.ts",
  "customer-project-integrity.integration.test.ts",
  "project-controls-numbering.integration.test.ts",
  "compliance-upload.integration.test.ts",
  "subcontractor-review.integration.test.ts",
  "itb-evidence-mapping.integration.test.ts",
  "itb-documents.integration.test.ts",
  "release-gates.integration.test.ts",
  "integration-job-recovery.integration.test.ts",
  "integration-connection.integration.test.ts",
  "integrations.integration.test.ts",
  "integration-work-recording.integration.test.ts",
  "opportunity-preconstruction.integration.test.ts",
  "inline-customer-creation.integration.test.ts",
  "supplier-orders.integration.test.ts",
  "platform-provisioning.integration.test.ts",
  "signatures.integration.test.ts",
];
const requestedTests = process.env.INTEGRATION_TEST_FILES
  ?.split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const integrationTests = requestedTests?.length
  ? requestedTests.map((name) => {
    if (!allIntegrationTests.includes(name)) throw new Error(`Unknown integration test: ${name}`);
    return name;
  })
  : allIntegrationTests;
const integrationTestPaths = integrationTests.map((name) => path.join(testDir, name));

try {
  await build({
    entryPoints: integrationTestPaths,
    platform: "node",
    bundle: true,
    format: "esm",
    outdir,
    outExtension: { ".js": ".mjs" },
    external: [
      "*.node",
      "@google-cloud/*",
      "@google/*",
      "pg-native",
    ],
    plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
    banner: {
      js: `import { createRequire as __createRequire } from "node:module";
import __path from "node:path";
import __url from "node:url";
globalThis.require = __createRequire(import.meta.url);
globalThis.__filename = __url.fileURLToPath(import.meta.url);
globalThis.__dirname = __path.dirname(globalThis.__filename);`,
    },
  });

  const testFiles = integrationTests.map((name) => path.join(outdir, name.replace(/\.ts$/, ".mjs")));
  if (!requestedTests?.length) testFiles.push(path.join(testDir, "auth-test-header.integration.test.mjs"));
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", ...testFiles], {
      env: {
        ...process.env,
        APP_ENV: "test",
        CLAMSCAN_PATH: path.join(testDir, "fake-clamscan.mjs"),
        MALWARE_SCANNER_TIMEOUT_MS: "1000",
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  await rm(outdir, { recursive: true, force: true });
}