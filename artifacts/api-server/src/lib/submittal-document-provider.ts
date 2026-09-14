export type DocumentProviderKey = "google_workspace";

export type DocumentProviderConnector = {
  proxy: (
    connectorName: string,
    path: string,
    options?: { method?: string; headers?: Record<string, string> },
  ) => Promise<globalThis.Response>;
};

export type ExternalDocumentReference = {
  externalId: string;
  name: string;
  contentType: string;
  size: number | null;
  modifiedAt: string | null;
  sourceUrl: string | null;
};

export type ImportedExternalDocument = ExternalDocumentReference & {
  bytes: Buffer;
};

export class DocumentProviderError extends Error {
  readonly status: number;

  constructor(message: string, status = 424) {
    super(message);
    this.status = status;
    this.name = "DocumentProviderError";
  }
}

const connectorNameByProvider: Record<DocumentProviderKey, string> = {
  google_workspace: "google-mail",
};

const nativeGoogleMimeTypes: Record<string, { contentType: string; extension: string }> = {
  "application/vnd.google-apps.document": { contentType: "application/pdf", extension: ".pdf" },
  "application/vnd.google-apps.presentation": { contentType: "application/pdf", extension: ".pdf" },
  "application/vnd.google-apps.spreadsheet": {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: ".xlsx",
  },
};

const maxDocumentSize = 100 * 1024 * 1024;
const supportedContentTypes = new Set([
  "application/pdf",
  "application/octet-stream",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const cleanName = (value: string) =>
  value.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).pop()?.trim().slice(0, 255) || "external-document";

const safeSourceUrl = (value: unknown) => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["drive.google.com", "docs.google.com"].includes(url.hostname)
      ? url.toString().slice(0, 2000)
      : null;
  } catch {
    return null;
  }
};

const providerKey = (value: string): DocumentProviderKey => {
  if (value === "google_workspace") return value;
  throw new DocumentProviderError("Unsupported document provider", 400);
};

const externalId = (value: string) => {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    throw new DocumentProviderError("Invalid external document id", 400);
  }
  return value;
};

const readJson = async (response: globalThis.Response) => {
  if (!response.ok) throw new DocumentProviderError(`Document provider returned ${response.status}`, response.status === 404 ? 404 : 424);
  return response.json() as Promise<Record<string, unknown>>;
};

const readBytes = async (response: globalThis.Response) => {
  if (!response.ok) throw new DocumentProviderError(`Document provider returned ${response.status}`, response.status === 404 ? 404 : 424);
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maxDocumentSize) throw new DocumentProviderError("External document exceeds the 100 MB limit", 413);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxDocumentSize) throw new DocumentProviderError("External document exceeds the 100 MB limit", 413);
  return bytes;
};

const serializeFile = (file: Record<string, unknown>): ExternalDocumentReference | null => {
  if (typeof file.id !== "string" || typeof file.name !== "string" || typeof file.mimeType !== "string") return null;
  const native = nativeGoogleMimeTypes[file.mimeType];
  const contentType = native?.contentType ?? file.mimeType;
  if (!native && !supportedContentTypes.has(contentType)) return null;
  const size = file.size === undefined || file.size === null ? null : Number(file.size);
  return {
    externalId: externalId(file.id),
    name: cleanName(file.name),
    contentType,
    size: Number.isFinite(size) ? size : null,
    modifiedAt: typeof file.modifiedTime === "string" ? file.modifiedTime : null,
    sourceUrl: safeSourceUrl(file.webViewLink),
  };
};

export const createSubmittalDocumentProvider = (connector: DocumentProviderConnector) => ({
  async listFiles(rawProviderKey: string, search: string, pageToken?: string) {
    const provider = providerKey(rawProviderKey);
    const normalizedSearch = search.replace(/[\r\n]/g, " ").trim().slice(0, 120);
    const query = normalizedSearch
      ? `trashed = false and name contains '${normalizedSearch.replace(/'/g, "\\'")}'`
      : "trashed = false";
    const params = new URLSearchParams({
      q: query,
      pageSize: "25",
      orderBy: "modifiedTime desc",
      spaces: "drive",
      fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)",
    });
    if (pageToken) params.set("pageToken", pageToken.slice(0, 2000));
    const result = await readJson(await connector.proxy(
      connectorNameByProvider[provider],
      `/drive/v3/files?${params.toString()}`,
    ));
    const files = Array.isArray(result.files)
      ? result.files.map((file) => serializeFile(file as Record<string, unknown>)).filter((file): file is ExternalDocumentReference => Boolean(file))
      : [];
    return {
      files,
      nextPageToken: typeof result.nextPageToken === "string" ? result.nextPageToken : null,
    };
  },

  async importFile(rawProviderKey: string, rawExternalId: string): Promise<ImportedExternalDocument> {
    const provider = providerKey(rawProviderKey);
    const id = externalId(rawExternalId);
    const connectorName = connectorNameByProvider[provider];
    const metadata = await readJson(await connector.proxy(
      connectorName,
      `/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime,webViewLink`,
    ));
    const reference = serializeFile(metadata);
    if (!reference) throw new DocumentProviderError("External file type is not supported for submittals", 415);
    if (reference.size !== null && reference.size > maxDocumentSize) {
      throw new DocumentProviderError("External document exceeds the 100 MB limit", 413);
    }
    const native = nativeGoogleMimeTypes[String(metadata.mimeType)];
    const path = native
      ? `/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(native.contentType)}`
      : `/drive/v3/files/${encodeURIComponent(id)}?alt=media`;
    const bytes = await readBytes(await connector.proxy(connectorName, path));
    return {
      ...reference,
      name: native && !reference.name.toLowerCase().endsWith(native.extension) ? `${reference.name}${native.extension}` : reference.name,
      contentType: native?.contentType ?? reference.contentType,
      size: bytes.length,
      bytes,
    };
  },
});