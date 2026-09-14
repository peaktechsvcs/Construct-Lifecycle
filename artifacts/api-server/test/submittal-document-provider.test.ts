import assert from "node:assert/strict";
import test from "node:test";
import { createSubmittalDocumentProvider, DocumentProviderError, type DocumentProviderConnector } from "../src/lib/submittal-document-provider.ts";

const response = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const fakeConnector = (handler: (path: string) => globalThis.Response | Promise<globalThis.Response>) => {
  const calls: string[] = [];
  const connector: DocumentProviderConnector = {
    proxy: async (_connectorName, path) => {
      calls.push(path);
      return handler(path);
    },
  };
  return { connector, calls };
};

test("lists supported Google Drive references and omits unsupported files", async () => {
  const { connector, calls } = fakeConnector(() => response({
    files: [
      {
        id: "drive-pdf",
        name: "Plans.pdf",
        mimeType: "application/pdf",
        size: "2048",
        modifiedTime: "2026-09-12T10:00:00Z",
        webViewLink: "https://drive.google.com/file/d/drive-pdf/view",
      },
      { id: "drive-folder", name: "Folder", mimeType: "application/vnd.google-apps.folder" },
    ],
    nextPageToken: "next",
  }));

  const result = await createSubmittalDocumentProvider(connector).listFiles("google_workspace", "Plans");

  assert.equal(result.nextPageToken, "next");
  assert.deepEqual(result.files[0], {
    externalId: "drive-pdf",
    name: "Plans.pdf",
    contentType: "application/pdf",
    size: 2048,
    modifiedAt: "2026-09-12T10:00:00Z",
    sourceUrl: "https://drive.google.com/file/d/drive-pdf/view",
  });
  assert.equal(result.files.length, 1);
  assert.match(calls[0], /\/drive\/v3\/files\?/);
  assert.match(calls[0], /name\+contains/);
});

test("imports a binary Drive file through the managed connector", async () => {
  const { connector, calls } = fakeConnector((path) => path.includes("alt=media")
    ? new Response(Buffer.from("pdf-bytes"), { status: 200, headers: { "content-type": "application/pdf", "content-length": "9" } })
    : response({
      id: "drive-pdf",
      name: "Plans.pdf",
      mimeType: "application/pdf",
      size: "9",
      modifiedTime: "2026-09-12T10:00:00Z",
      webViewLink: "https://docs.google.com/file/d/drive-pdf/view",
    }));

  const result = await createSubmittalDocumentProvider(connector).importFile("google_workspace", "drive-pdf");

  assert.equal(result.contentType, "application/pdf");
  assert.equal(result.size, 9);
  assert.equal(result.bytes.toString(), "pdf-bytes");
  assert.equal(calls.length, 2);
});

test("exports native Google Docs and rejects invalid provider identifiers", async () => {
  const { connector, calls } = fakeConnector((path) => path.includes("/export?")
    ? new Response(Buffer.from("exported-pdf"), { status: 200, headers: { "content-type": "application/pdf" } })
    : response({
      id: "doc_123",
      name: "Specification",
      mimeType: "application/vnd.google-apps.document",
      webViewLink: "https://docs.google.com/document/d/doc_123/edit",
    }));

  const result = await createSubmittalDocumentProvider(connector).importFile("google_workspace", "doc_123");
  assert.equal(result.name, "Specification.pdf");
  assert.equal(result.contentType, "application/pdf");
  assert.equal(calls.length, 2);

  await assert.rejects(
    () => createSubmittalDocumentProvider(connector).importFile("google_workspace", "../secrets"),
    (error) => error instanceof DocumentProviderError && error.status === 400,
  );
});

test("preserves provider failures for fail-closed route handling", async () => {
  const { connector } = fakeConnector(() => response({}, 401));
  await assert.rejects(
    () => createSubmittalDocumentProvider(connector).listFiles("google_workspace", ""),
    (error) => error instanceof DocumentProviderError && error.status === 424,
  );
});