import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

globalThis.require = createRequire(import.meta.url);

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(testDir, "..");
const childSource = (appBundlePath) => `
  const { default: app } = await import(${JSON.stringify(appBundlePath)});
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("API server did not expose a TCP address");
  const response = await fetch(\`http://127.0.0.1:\${address.port}/api/supplier-orders\`, {
    headers: { "x-test-clerk-user-id": "header-must-not-authenticate" },
  });
  console.log(\`AUTH_TEST_HEADER_STATUS:\${response.status}\`);
  await new Promise((resolve) => server.close(resolve));
  if (response.status !== 401) process.exitCode = 1;
`;

function runWithAppEnv(appEnv, childScriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [childScriptPath],
      {
        cwd: projectDir,
        env: {
          ...process.env,
          APP_ENV: appEnv,
          RUNTIME_ENVIRONMENT_ID: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

test("test sign-in headers remain unauthorized outside test mode", async () => {
  const tempDir = await mkdtemp(path.join(projectDir, ".auth-header-"));
  try {
    const appBundlePath = path.join(tempDir, "app.mjs");
    const childScriptPath = path.join(tempDir, "child.mjs");
    await build({
      entryPoints: [path.join(projectDir, "src/app.ts")],
      outdir: tempDir,
      platform: "node",
      bundle: true,
      format: "esm",
      outExtension: { ".js": ".mjs" },
      external: ["*.node", "@google-cloud/*", "@google/*", "pg-native"],
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
    await writeFile(childScriptPath, childSource(appBundlePath), "utf8");

    for (const appEnv of ["development", "demo", "production"]) {
      const result = await runWithAppEnv(appEnv, childScriptPath);
      assert.equal(result.code, 0, `${appEnv} subprocess failed:\n${result.output}`);
      assert.match(result.output, /AUTH_TEST_HEADER_STATUS:401/, `${appEnv} accepted the test sign-in header:\n${result.output}`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});