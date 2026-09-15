import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { configureDocumentMalwareScanner, screenStoredDocument, type MalwareScanStatus } from "../src/lib/documentScreening.ts";
import {
  isAllowedSubmittalDocumentType,
  maxSubmittalDocumentSize,
  sanitizeSubmittalFileName,
} from "../src/lib/submittalDocumentPolicy.ts";

const fakeFile = (value: string | Buffer) => ({
  createReadStream: () => Readable.from([Buffer.isBuffer(value) ? value : Buffer.from(value)]),
}) as never;

const screenWith = async (scanStatus: MalwareScanStatus, value = "%PDF-1.7\ncontent") => {
  configureDocumentMalwareScanner({ scan: async () => scanStatus });
  return screenStoredDocument(fakeFile(value), "application/pdf", Buffer.byteLength(value));
};

test("accepts a non-empty PDF with a matching signature", async () => {
  assert.deepEqual(await screenWith("clean"), { status: "accepted", scanStatus: "clean" });
});

test("rejects a document whose bytes do not match its declared type", async () => {
  const result = await screenStoredDocument(fakeFile("not a pdf"), "application/pdf", 10);
  assert.deepEqual(result, { status: "rejected", reason: "content_mismatch" });
});

test("rejects the standard antivirus test signature", async () => {
  const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  const result = await screenStoredDocument(fakeFile(eicar), "text/plain", eicar.length);
  assert.deepEqual(result, { status: "rejected", reason: "malware_signature", scanStatus: "infected" });
});

test("surfaces infected, unavailable, and timeout scanner outcomes without scanner details", async () => {
  assert.deepEqual(await screenWith("infected"), {
    status: "rejected",
    reason: "malware_infected",
    scanStatus: "infected",
  });
  assert.deepEqual(await screenWith("unavailable"), {
    status: "rejected",
    reason: "malware_unavailable",
    scanStatus: "unavailable",
  });
  assert.deepEqual(await screenWith("timeout"), {
    status: "rejected",
    reason: "malware_timeout",
    scanStatus: "timeout",
  });
});

test("submittal upload policy rejects ambiguous binary types and caps size", () => {
  assert.equal(isAllowedSubmittalDocumentType("application/pdf"), true);
  assert.equal(isAllowedSubmittalDocumentType("application/octet-stream"), false);
  assert.equal(maxSubmittalDocumentSize, 100 * 1024 * 1024);
  assert.equal(sanitizeSubmittalFileName("../../plans/roof.pdf"), "roof.pdf");
  assert.equal(sanitizeSubmittalFileName("bad\u0000name.pdf"), "badname.pdf");
});