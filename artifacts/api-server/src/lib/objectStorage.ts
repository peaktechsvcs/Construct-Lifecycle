import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Object storage backed by Cloudflare R2 over the S3 API.
 *
 * Replaces the previous Google Cloud Storage client, which authenticated
 * through a Replit sidecar on 127.0.0.1:1106 and so only worked inside a
 * Replit container.
 *
 * Stored object paths keep the exact `/objects/<key>` form used before, so
 * the object_path columns in Postgres need no migration.
 *
 * Required environment:
 *   R2_S3_ENDPOINT        https://<account-id>.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET             e.g. construct-lc-dev
 */

const SIGNED_URL_TTL_SECONDS = 15 * 60;

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
  }
}

/**
 * Provider-neutral handle to a stored object.
 *
 * Exists so modules that need to read bytes more than once (document
 * screening reads a prefix, then streams the whole object to the scanner)
 * do not depend on any vendor SDK type. Previously this was the
 * `@google-cloud/storage` `File` class, which is what coupled
 * documentScreening.ts to GCS.
 */
export interface StoredObject {
  /** Byte range is inclusive on both ends, matching HTTP Range semantics. */
  openStream(range?: { start: number; end: number }): Promise<Readable>;
}

export interface StoredObjectMetadata {
  contentType?: string;
  size?: number;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

let client: S3Client | undefined;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      // R2 ignores region but the SDK requires one.
      region: "auto",
      endpoint: requireEnv("R2_S3_ENDPOINT"),
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
      forcePathStyle: true,
    });
  }
  return client;
}

function bucket(): string {
  return requireEnv("R2_BUCKET");
}

/** Unchanged from the GCS implementation — the stored form must not drift. */
function assertValidObjectPath(objectPath: string): string {
  if (!/^\/objects\/[A-Za-z0-9._/-]+$/.test(objectPath)) {
    throw new Error("Invalid object path");
  }
  return objectPath.slice("/objects/".length);
}

function assertValidPrefix(prefix: string): string {
  if (!/^[A-Za-z0-9/_-]{1,80}$/.test(prefix) || prefix.includes("..")) {
    throw new Error("Invalid object storage prefix");
  }
  return prefix.replace(/^\/+|\/+$/g, "");
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

async function getBody(Key: string, range?: { start: number; end: number }): Promise<Readable> {
  try {
    const result = await s3().send(new GetObjectCommand({
      Bucket: bucket(),
      Key,
      ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
    }));
    if (!result.Body) throw new ObjectNotFoundError();
    return result.Body as Readable;
  } catch (error) {
    if (isNotFound(error)) throw new ObjectNotFoundError();
    throw error;
  }
}

export class ObjectStorageService {
  /**
   * Presigned PUT the browser uploads to directly. Bytes never pass through
   * the API process.
   */
  async requestUpload(prefix = "submittals") {
    const key = `${assertValidPrefix(prefix)}/${randomUUID()}`;
    const uploadURL = await getSignedUrl(
      s3(),
      new PutObjectCommand({ Bucket: bucket(), Key: key }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
    return { uploadURL, objectPath: `/objects/${key}` };
  }

  /** Server-side write, for generated artifacts such as assembled PDFs. */
  async storeBytes(prefix: string, bytes: Buffer, contentType: string) {
    const key = `${assertValidPrefix(prefix)}/${randomUUID()}`;
    await s3().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }));
    return { objectPath: `/objects/${key}` };
  }

  /**
   * Neutral handle for callers that read the object more than once.
   * Does no network work until openStream is called.
   */
  getStoredObject(objectPath: string): StoredObject {
    const Key = assertValidObjectPath(objectPath);
    return { openStream: (range) => getBody(Key, range) };
  }

  /** Throws ObjectNotFoundError if absent. Replaces the old existence check. */
  async assertExists(objectPath: string): Promise<void> {
    await this.getMetadata(objectPath);
  }

  /** Replaces file.getMetadata(). */
  async getMetadata(objectPath: string): Promise<StoredObjectMetadata> {
    const Key = assertValidObjectPath(objectPath);
    try {
      const head = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key }));
      return { contentType: head.ContentType, size: head.ContentLength };
    } catch (error) {
      if (isNotFound(error)) throw new ObjectNotFoundError();
      throw error;
    }
  }

  /** Replaces file.download() — whole object into memory. */
  async downloadBytes(objectPath: string): Promise<Buffer> {
    const stream = await this.openReadStream(objectPath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /** Replaces file.createReadStream() — stream through the API to the client. */
  async openReadStream(objectPath: string): Promise<Readable> {
    return getBody(assertValidObjectPath(objectPath));
  }

  /**
   * Presigned GET, for redirecting the browser straight to R2 instead of
   * proxying bytes through the API.
   *
   * Not used by any route yet. Adopting it removes Railway egress and the
   * memory cost of streaming large files, at the price of a URL that acts as
   * a bearer credential until it expires, and weaker control over response
   * headers than setting them on the Express response. Worth revisiting
   * per-route when file volume justifies it — largest downloads first.
   */
  async getSignedDownloadUrl(
    objectPath: string,
    options: { fileName?: string; contentType?: string; inline?: boolean } = {},
  ): Promise<string> {
    const Key = assertValidObjectPath(objectPath);
    const disposition = options.fileName
      ? `${options.inline ? "inline" : "attachment"}; filename="${options.fileName.replace(/["\r\n]/g, "_")}"`
      : undefined;
    return getSignedUrl(
      s3(),
      new GetObjectCommand({
        Bucket: bucket(),
        Key,
        ResponseContentDisposition: disposition,
        ResponseContentType: options.contentType,
        ResponseCacheControl: "private, no-store",
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
  }

  async deleteObject(objectPath: string): Promise<void> {
    const Key = assertValidObjectPath(objectPath);
    await this.assertExists(objectPath);
    await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key }));
  }
}
