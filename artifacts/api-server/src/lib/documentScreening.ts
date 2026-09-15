import { spawn } from "node:child_process";
import type { File } from "@google-cloud/storage";

export type MalwareScanStatus = "clean" | "infected" | "unavailable" | "timeout";

export type DocumentMalwareScanner = {
  scan: (file: File, timeoutMs: number) => Promise<MalwareScanStatus>;
};

export type DocumentScreeningResult =
  | { status: "accepted"; scanStatus: "clean" }
  | {
    status: "rejected";
    reason: "empty" | "content_mismatch" | "malware_signature" | "malware_infected" | "malware_unavailable" | "malware_timeout";
    scanStatus?: MalwareScanStatus;
  };

const EICAR_TEST_SIGNATURE = Buffer.from(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  "utf8",
);

const readPrefix = async (file: File, maxBytes: number) => {
  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise<Buffer>((resolve, reject) => {
    const stream = file.createReadStream({ start: 0, end: maxBytes - 1 });
    const timeout = setTimeout(() => {
      stream.destroy(new Error("Document screening timed out"));
    }, 10_000);
    stream.on("data", (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += value.length;
      chunks.push(value);
    });
    stream.on("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).subarray(0, maxBytes));
    });
    stream.on("close", () => clearTimeout(timeout));
    stream.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
};

const hasBytes = (value: Buffer, signature: Buffer) => value.subarray(0, signature.length).equals(signature);

const hasEicarSignature = (value: Buffer) => value.includes(EICAR_TEST_SIGNATURE);

const scannerTimeoutMs = () => {
  const configured = Number(process.env.MALWARE_SCANNER_TIMEOUT_MS ?? 15_000);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(configured, 60_000)) : 15_000;
};

const scanWithClamScan = (file: File, timeoutMs: number): Promise<MalwareScanStatus> => new Promise((resolve) => {
  const executable = process.env.CLAMSCAN_PATH?.trim() || "clamscan";
  const args = [
    ...(process.env.CLAMAV_DATABASE_DIR ? ["--database", process.env.CLAMAV_DATABASE_DIR] : []),
    "--no-summary",
    "--infected",
    "--stdout",
    "-",
  ];
  const command = executable.endsWith(".mjs") ? process.execPath : executable;
  const commandArgs = executable.endsWith(".mjs") ? [executable, ...args] : args;
  const child = spawn(command, commandArgs, {
    stdio: ["pipe", "ignore", "ignore"],
  });
  let settled = false;
  let timedOut = false;
  let inputEnded = false;
  const input = file.createReadStream();
  const finish = (status: MalwareScanStatus) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    input.destroy();
    if (!child.killed) child.kill("SIGKILL");
    resolve(status);
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    input.destroy();
    child.kill("SIGKILL");
  }, timeoutMs);

  child.once("error", () => finish("unavailable"));
  child.once("close", (code) => {
    if (timedOut) {
      finish("timeout");
    } else if (code === 0) {
      finish("clean");
    } else if (code === 1) {
      finish("infected");
    } else {
      finish("unavailable");
    }
  });
  input.on("data", (chunk: Buffer | string) => {
    if (settled || inputEnded) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (!child.stdin.write(bytes)) input.pause();
  });
  child.stdin.on("drain", () => input.resume());
  input.once("end", () => {
    inputEnded = true;
    child.stdin.end();
  });
  input.once("error", () => finish("unavailable"));
  child.stdin.once("error", () => finish("unavailable"));
});

const defaultScanner: DocumentMalwareScanner = { scan: scanWithClamScan };
let configuredScanner: DocumentMalwareScanner | undefined;

/**
 * Allows authenticated integration tests to exercise scanner outcomes without
 * requiring a virus database or exposing scanner controls through HTTP.
 */
export function configureDocumentMalwareScanner(scanner: DocumentMalwareScanner | undefined) {
  configuredScanner = scanner;
}


/**
 * Stored bytes are screened by the provisioned ClamAV executable before a
 * document becomes downloadable. The signature checks remain intentionally
 * provider-neutral and run first so malformed uploads fail without invoking
 * the scanner.
 *
 * Scanner output is reduced to clean/infected/unavailable/timeout. Detailed
 * scanner output is never returned to callers or persisted.
 */
export async function screenStoredDocument(
  file: File,
  contentType: string,
  size: number,
): Promise<DocumentScreeningResult> {
  const prefix = await readPrefix(file, 8192);
  if (size <= 0 || prefix.length === 0) return { status: "rejected", reason: "empty" };
  if (hasEicarSignature(prefix)) return { status: "rejected", reason: "malware_signature", scanStatus: "infected" };

  const matchesExpectedSignature =
    contentType === "application/pdf"
      ? prefix.subarray(0, 5).equals(Buffer.from("%PDF-"))
      : contentType === "image/png"
        ? hasBytes(prefix, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : contentType === "image/jpeg"
          ? hasBytes(prefix, Buffer.from([0xff, 0xd8, 0xff]))
          : contentType === "image/gif"
            ? prefix.subarray(0, 6).toString("ascii") === "GIF87a" || prefix.subarray(0, 6).toString("ascii") === "GIF89a"
            : contentType === "application/zip"
              || contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              || contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              || contentType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
              ? hasBytes(prefix, Buffer.from([0x50, 0x4b, 0x03, 0x04]))
              : true;

  if (!matchesExpectedSignature) return { status: "rejected", reason: "content_mismatch" };

  const scanStatus = await (configuredScanner ?? defaultScanner).scan(file, scannerTimeoutMs());
  if (scanStatus === "clean") return { status: "accepted", scanStatus };
  if (scanStatus === "infected") return { status: "rejected", reason: "malware_infected", scanStatus };
  if (scanStatus === "timeout") return { status: "rejected", reason: "malware_timeout", scanStatus };
  return { status: "rejected", reason: "malware_unavailable", scanStatus };
}