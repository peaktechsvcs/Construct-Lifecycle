import type { File } from "@google-cloud/storage";

export type DocumentScreeningResult =
  | { status: "accepted" }
  | { status: "rejected"; reason: "empty" | "content_mismatch" | "malware_signature" };

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

/**
 * This is a deliberately small, provider-neutral screening boundary.
 *
 * It rejects empty files, obvious content-type/magic-byte mismatches, and the
 * standard antivirus test signature before a document becomes downloadable.
 * A production deployment can replace or extend this function with ClamAV or
 * a managed scanner without changing the upload route or database model.
 */
export async function screenStoredDocument(
  file: File,
  contentType: string,
  size: number,
): Promise<DocumentScreeningResult> {
  const prefix = await readPrefix(file, 8192);
  if (size <= 0 || prefix.length === 0) return { status: "rejected", reason: "empty" };
  if (hasEicarSignature(prefix)) return { status: "rejected", reason: "malware_signature" };

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

  return matchesExpectedSignature
    ? { status: "accepted" }
    : { status: "rejected", reason: "content_mismatch" };
}