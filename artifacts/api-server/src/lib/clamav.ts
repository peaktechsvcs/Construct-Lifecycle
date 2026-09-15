import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const defaultDatabaseDirectory = "/tmp/construct-lifecycle-clamav";

const configuredTimeout = () => {
  const value = Number(process.env.CLAMAV_BOOTSTRAP_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(value) ? Math.max(10_000, Math.min(value, 300_000)) : 120_000;
};

/**
 * ClamAV packages do not ship virus definitions. Refresh them at process
 * startup so the API has a real signature database before accepting files.
 * Failure is intentionally non-fatal: document screening remains fail-closed
 * and reports unavailable until a managed database becomes reachable.
 */
export async function ensureClamAvDatabase() {
  if (process.env.MALWARE_SCANNER_BOOTSTRAP === "disabled") return;

  const databaseDirectory = process.env.CLAMAV_DATABASE_DIR?.trim() || defaultDatabaseDirectory;
  const configPath = path.join(databaseDirectory, "freshclam.conf");
  const config = [
    `DatabaseDirectory ${databaseDirectory}`,
    "DatabaseMirror database.clamav.net",
    "Foreground yes",
    "ScriptedUpdates yes",
    "CompressLocalDatabase no",
    "LogTime no",
    "",
  ].join("\n");

  try {
    await mkdir(databaseDirectory, { recursive: true });
    await writeFile(configPath, config, { mode: 0o600 });
    const executable = process.env.FRESHCLAM_PATH?.trim() || "freshclam";
    await new Promise<void>((resolve) => {
      const child = spawn(executable, ["--config-file", configPath, "--stdout", "--no-warnings"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, configuredTimeout());
      child.once("error", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    process.env.CLAMAV_DATABASE_DIR = databaseDirectory;
  } catch {
    // Screening converts missing definitions or an unavailable executable into
    // the public "unavailable" outcome. Startup must still serve the API.
  }
}