import assert from "node:assert/strict";
import test from "node:test";
import {
  getSignatureProviderAvailability,
  getSignatureProvider,
  registerSignatureProvider,
} from "../src/lib/signatures/provider.ts";
import { registerDocuSignSignatureProvider } from "../src/lib/signatures/docusign.ts";
import {
  canTransitionSignatureRequestStatus,
} from "../src/lib/signatures/state.ts";
import { validateAndNormalizeSignatureSigners } from "../src/lib/signatures/validation.ts";

const providerKey = "test-esign-provider";

test("a signature adapter is unavailable until its connected provider key is supplied", () => {
  registerSignatureProvider({
    providerKey,
    capabilities: new Set(["send", "status", "cancel", "download_signed_document"]),
    send: async () => ({ providerRequestId: "request" }),
    getStatus: async () => ({ status: "sent" }),
    cancel: async () => undefined,
    downloadSignedDocument: async () => ({ objectPath: "path", fileName: "signed.pdf" }),
  });
  assert.deepEqual(getSignatureProviderAvailability([]), { available: false, providerKey: null });
  assert.deepEqual(getSignatureProviderAvailability(["unknown-provider"]), { available: false, providerKey: null });
  assert.deepEqual(getSignatureProviderAvailability([providerKey]), { available: true, providerKey });
});

test("signer validation normalizes values and rejects duplicate recipients", () => {
  const result = validateAndNormalizeSignatureSigners([
    { name: "  Jordan Lee ", email: "JORDAN@example.com", role: " Owner " },
  ]);
  assert.deepEqual(result, {
    ok: true,
    signers: [{ name: "Jordan Lee", email: "jordan@example.com", role: "Owner", signingOrder: 1 }],
  });
  assert.equal(validateAndNormalizeSignatureSigners([
    { name: "Jordan", email: "jordan@example.com" },
    { name: "Jordan 2", email: " JORDAN@example.com " },
  ]).ok, false);
  assert.equal(validateAndNormalizeSignatureSigners([
    { name: " ", email: "jordan@example.com" },
  ]).ok, false);
});

test("signature status transitions keep terminal states terminal", () => {
  assert.equal(canTransitionSignatureRequestStatus("draft", "ready"), true);
  assert.equal(canTransitionSignatureRequestStatus("ready", "sending"), true);
  assert.equal(canTransitionSignatureRequestStatus("sending", "sent"), true);
  assert.equal(canTransitionSignatureRequestStatus("sent", "partially_signed"), true);
  assert.equal(canTransitionSignatureRequestStatus("partially_signed", "completed"), true);
  assert.equal(canTransitionSignatureRequestStatus("completed", "sent"), false);
  assert.equal(canTransitionSignatureRequestStatus("canceled", "ready"), false);
});

test("DocuSign adapter sends, polls, cancels, and downloads through the managed connector", async () => {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const connector = {
    proxy: async (_connectorName: string, path: string, options?: { method?: string; body?: unknown }) => {
      calls.push({ path, method: options?.method ?? "GET", body: options?.body });
      if (path.endsWith("/accounts")) {
        return new Response(JSON.stringify({ accounts: [{ accountId: "account-1" }] }), { status: 200 });
      }
      if (path.endsWith("/envelopes") && options?.method === "POST") {
        return new Response(JSON.stringify({ envelopeId: "envelope-1" }), { status: 200 });
      }
      if (path.endsWith("/envelope-1") && (!options?.method || options.method === "GET")) {
        return new Response(JSON.stringify({ status: "completed" }), { status: 200 });
      }
      if (path.endsWith("/envelope-1") && options?.method === "PUT") {
        return new Response(JSON.stringify({ status: "voided" }), { status: 200 });
      }
      if (path.endsWith("/documents/combined")) {
        return new Response(Buffer.from("%PDF-signed"), {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  };
  registerDocuSignSignatureProvider(connector as never, registerSignatureProvider);
  const provider = getSignatureProvider("docusign");
  assert(provider);

  const context = { tenantId: 1, environmentId: 2, integrationId: 3 };
  const sent = await provider.send(context, {
    title: "Approved submittal",
    fileName: "package.pdf",
    contentType: "application/pdf",
    documentBytes: Buffer.from("%PDF-package"),
    signers: [{ name: "Jordan Lee", email: "jordan@example.com", role: "Owner", signingOrder: 1 }],
  });
  assert.equal(sent.providerRequestId, "envelope-1");
  assert.equal((calls.find((call) => call.method === "POST")?.body as { recipients: { signers: Array<{ email: string }> } }).recipients.signers[0].email, "jordan@example.com");
  assert.deepEqual(await provider.getStatus(context, "envelope-1"), {
    status: "completed",
    metadata: { providerStatus: "completed" },
  });
  await provider.cancel(context, "envelope-1");
  const document = await provider.downloadSignedDocument(context, "envelope-1");
  assert.equal(document.contentType, "application/pdf");
  assert.equal(document.fileName, "signed-envelope-1.pdf");
  assert.equal(document.bytes?.toString(), "%PDF-signed");
});