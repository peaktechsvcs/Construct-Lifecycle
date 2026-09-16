import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDir = path.join(rootDir, "lib/db/migrations");
const sourceDatabaseUrl = process.env.DATABASE_URL;

if (!sourceDatabaseUrl) {
  throw new Error("DATABASE_URL is required for clean database validation");
}

const migrationPattern = /^(\d{4}(?:\.\d+)?)_(.+)\.sql$/;
const migrationNames = (await readdir(migrationDir))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const migrations = migrationNames.map((name) => {
  const match = migrationPattern.exec(name);
  if (!match) throw new Error(`Migration filename must start with a version: ${name}`);
  return { name, version: match[1], filePath: path.join(migrationDir, name) };
});
const duplicateVersions = migrations
  .map(({ version }) => version)
  .filter((version, index, versions) => versions.indexOf(version) !== index);
if (duplicateVersions.length > 0) {
  throw new Error(`Duplicate migration versions: ${[...new Set(duplicateVersions)].join(", ")}`);
}

function compareVersions(left, right) {
  const leftParts = left.version.split(".").map(Number);
  const rightParts = right.version.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.name.localeCompare(right.name);
}

migrations.sort(compareVersions);

const databaseName = `clc_migration_validation_${process.pid}_${Date.now()}`;
if (!/^clc_migration_validation_\d+_\d+$/.test(databaseName)) {
  throw new Error("Generated temporary database name is invalid");
}

function databaseUrlFor(name) {
  const url = new URL(sourceDatabaseUrl);
  url.pathname = `/${name}`;
  url.hash = "";
  return url.toString();
}

async function run(command, args, env = process.env) {
  try {
    await execFileAsync(command, args, {
      cwd: rootDir,
      env,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const redact = (value) => value
      .replaceAll(sourceDatabaseUrl, "[DATABASE_URL]")
      .replaceAll(temporaryDatabaseUrl, "[TEMP_DATABASE_URL]");
    if (error && typeof error === "object") {
      for (const key of ["message", "cmd", "stdout", "stderr"]) {
        if (typeof error[key] === "string") error[key] = redact(error[key]);
      }
    }
    throw error;
  }
}

const temporaryDatabaseUrl = databaseUrlFor(databaseName);
let created = false;

try {
  await run("psql", [
    sourceDatabaseUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `CREATE DATABASE "${databaseName}"`,
  ]);
  created = true;

  await run("pnpm", [
    "--filter",
    "@workspace/db",
    "exec",
    "drizzle-kit",
    "push",
    "--config",
    "./drizzle.config.ts",
    "--force",
  ], {
    ...process.env,
    APP_ENV: "development",
    DATABASE_URL: temporaryDatabaseUrl,
    DIRECT_URL: temporaryDatabaseUrl,
  });

  for (const migration of migrations) {
    process.stdout.write(`Applying ${migration.name}\n`);
    await run("psql", [
      temporaryDatabaseUrl,
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      migration.filePath,
    ], {
      ...process.env,
      APP_ENV: "development",
    });
  }

  process.stdout.write("Running feature-control integration preflight\n");
  await run("pnpm", [
    "--filter",
    "@workspace/api-server",
    "exec",
    "node",
    "test/run-integration.mjs",
  ], {
    ...process.env,
    APP_ENV: "test",
    DATABASE_URL: temporaryDatabaseUrl,
    INTEGRATION_TEST_FILES: "feature-feedback.integration.test.ts",
  });
  process.stdout.write("Clean database migration validation passed.\n");
} finally {
  if (created) {
    await run("psql", [
      sourceDatabaseUrl,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `DROP DATABASE "${databaseName}" WITH (FORCE)`,
    ]);
  }
}