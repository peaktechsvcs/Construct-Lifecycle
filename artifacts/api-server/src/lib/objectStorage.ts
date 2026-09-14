import { randomUUID } from "node:crypto";
import { Storage, type File } from "@google-cloud/storage";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
  }
}

const parseStoragePath = (value: string) => {
  const normalized = value.startsWith("/") ? value : `/${value}`;
  const [bucketName, ...objectParts] = normalized.split("/").slice(1);
  if (!bucketName || objectParts.length === 0 || objectParts.join("/").includes("..")) {
    throw new Error("Invalid object storage path");
  }
  return { bucketName, objectName: objectParts.join("/") };
};

const signObjectUrl = async (bucketName: string, objectName: string, method: "PUT" | "GET" | "DELETE") => {
  const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Failed to sign object URL (${response.status})`);
  const body = await response.json() as { signed_url?: string };
  if (!body.signed_url) throw new Error("Storage returned no signed URL");
  return body.signed_url;
};

export class ObjectStorageService {
  private privateObjectDir() {
    const value = process.env.PRIVATE_OBJECT_DIR?.trim();
    if (!value) throw new Error("PRIVATE_OBJECT_DIR is not configured");
    return value.replace(/\/+$/, "");
  }

  async requestUpload(prefix = "submittals") {
    if (!/^[A-Za-z0-9/_-]{1,80}$/.test(prefix) || prefix.includes("..")) {
      throw new Error("Invalid object storage prefix");
    }
    const fullPath = `${this.privateObjectDir()}/${prefix.replace(/^\/+|\/+$/g, "")}/${randomUUID()}`;
    const { bucketName, objectName } = parseStoragePath(fullPath);
    const uploadURL = await signObjectUrl(bucketName, objectName, "PUT");
    return { uploadURL, objectPath: `/objects/${objectName}` };
  }

  async storeBytes(prefix: string, bytes: Buffer, contentType: string) {
    if (!/^[A-Za-z0-9/_-]{1,80}$/.test(prefix) || prefix.includes("..")) {
      throw new Error("Invalid object storage prefix");
    }
    const fullPath = `${this.privateObjectDir()}/${prefix.replace(/^\/+|\/+$/g, "")}/${randomUUID()}`;
    const { bucketName, objectName } = parseStoragePath(fullPath);
    await objectStorageClient.bucket(bucketName).file(objectName).save(bytes, {
      resumable: false,
      metadata: { contentType },
    });
    return { objectPath: `/objects/${objectName}` };
  }

  async getObjectFile(objectPath: string): Promise<File> {
    if (!/^\/objects\/[A-Za-z0-9._/-]+$/.test(objectPath)) {
      throw new Error("Invalid object path");
    }
    const { bucketName } = parseStoragePath(this.privateObjectDir());
    const objectName = objectPath.slice("/objects/".length);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }

  async deleteObject(objectPath: string) {
    const file = await this.getObjectFile(objectPath);
    await file.delete();
  }
}