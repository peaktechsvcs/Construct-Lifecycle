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

try {
  await build({
    entryPoints: [
      path.join(testDir, "tenant-isolation.integration.test.ts"),
      path.join(testDir, "billing.integration.test.ts"),
      path.join(testDir, "feature-feedback.integration.test.ts"),
      path.join(testDir, "customer-onboarding.integration.test.ts"),
      path.join(testDir, "invitation-rbac.integration.test.ts"),
      path.join(testDir, "customer-project-integrity.integration.test.ts"),
      path.join(testDir, "project-controls-numbering.integration.test.ts"),
      path.join(testDir, "compliance-upload.integration.test.ts"),
      path.join(testDir, "subcontractor-review.integration.test.ts"),
      path.join(testDir, "itb-evidence-mapping.integration.test.ts"),
      path.join(testDir, "itb-documents.integration.test.ts"),
      path.join(testDir, "release-gates.integration.test.ts"),
      path.join(testDir, "opportunity-preconstruction.integration.test.ts"),
      path.join(testDir, "supplier-orders.integration.test.ts"),
    ],
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

  const testFiles = [
    path.join(outdir, "tenant-isolation.integration.test.mjs"),
    path.join(outdir, "billing.integration.test.mjs"),
    path.join(outdir, "feature-feedback.integration.test.mjs"),
    path.join(outdir, "invitation-rbac.integration.test.mjs"),
    path.join(outdir, "customer-project-integrity.integration.test.mjs"),
    path.join(outdir, "project-controls-numbering.integration.test.mjs"),
    path.join(outdir, "compliance-upload.integration.test.mjs"),
    path.join(outdir, "subcontractor-review.integration.test.mjs"),
    path.join(outdir, "itb-evidence-mapping.integration.test.mjs"),
    path.join(outdir, "itb-documents.integration.test.mjs"),
    path.join(outdir, "release-gates.integration.test.mjs"),
    path.join(outdir, "opportunity-preconstruction.integration.test.mjs"),
    path.join(outdir, "supplier-orders.integration.test.mjs"),
    path.join(testDir, "auth-test-header.integration.test.mjs"),
  ];
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", ...testFiles], {
      env: { ...process.env, APP_ENV: "test" },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  await rm(outdir, { recursive: true, force: true });
}