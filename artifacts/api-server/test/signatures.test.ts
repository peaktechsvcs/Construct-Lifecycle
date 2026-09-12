import assert from "node:assert/strict";
import test from "node:test";
import {
  getSignatureProviderAvailability,
  registerSignatureProvider,
} from "../src/lib/signatures/provider.ts";
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
  assert.equal(canTransitionSignatureRequestStatus("sent", "partially_signed"), true);
  assert.equal(canTransitionSignatureRequestStatus("partially_signed", "completed"), true);
  assert.equal(canTransitionSignatureRequestStatus("completed", "sent"), false);
  assert.equal(canTransitionSignatureRequestStatus("canceled", "ready"), false);
});