import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { zipSync } from "fflate";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_OCR_PAGES,
  DOCUMENT_MAX_TEXT_CHARS,
  DOCUMENT_OCR_MIN_CONFIDENCE,
  DOCUMENT_OCR_TIMEOUT_MS,
  inferDocumentRole,
  parseConstructionDocument,
} from "../src/lib/itb-document-parsing.ts";

const execFileAsync = promisify(execFile);

const makeScan = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "clc-itb-test-"));
  const imagePath = path.join(directory, "scan.png");
  await execFileAsync("magick", [
    "-size", "1800x260", "xc:white",
    "-font", "DejaVu-Sans",
    "-fill", "black",
    "-pointsize", "72",
    "-gravity", "center",
    "-annotate", "0", "Project: OCR Test",
    imagePath,
  ]);
  return { directory, imagePath, bytes: await readFile(imagePath) };
};

test("parses bounded text documents into reviewable findings", async () => {
  const result = await parseConstructionDocument(
    "north-campus-itb.txt",
    "text/plain",
    Buffer.from("Project: North Campus Renovation\nIssuer: Northline Construction\nBid due: 2026-09-30\nMust submit insurance."),
  );
  assert.equal(result.needsReview, false);
  assert.equal(result.parser, "text");
  assert.equal(result.findings.find((finding) => finding.key === "project_name")?.value, "North Campus Renovation");
  assert.ok(result.findings.some((finding) => finding.key === "bid_due_date"));
  assert.ok(result.findings.every((finding) => finding.status === "proposed"));
});

test("parses DOCX XML without exposing archive instructions", async () => {
  const bytes = zipSync({
    "word/document.xml": new TextEncoder().encode("<w:document><w:p><w:r><w:t>Project: Safe Build</w:t></w:r></w:p></w:document>"),
  });
  const result = await parseConstructionDocument("scope.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from(bytes));
  assert.equal(result.parser, "docx-xml");
  assert.ok(result.text.includes("Project: Safe Build"));
  assert.ok(result.text.length <= DOCUMENT_MAX_TEXT_CHARS);
});

test("OCRs a common drawing scan with page evidence and confidence", async () => {
  const scan = await makeScan();
  try {
    const result = await parseConstructionDocument("A-101-plan.png", "image/png", scan.bytes);
    assert.equal(result.parser, "tesseract");
    assert.equal(result.needsReview, true);
    assert.equal(result.pageEvidence.length, 1);
    assert.equal(result.pageEvidence[0]?.page, 1);
    assert.ok(result.pageEvidence[0]?.text.includes("Project: OCR Test"));
    assert.ok((result.pageEvidence[0]?.confidence ?? 0) >= DOCUMENT_OCR_MIN_CONFIDENCE);
    const finding = result.findings.find((candidate) => candidate.key === "project_name");
    assert.equal(finding?.page, 1);
    assert.equal(finding?.ocrConfidence, result.pageEvidence[0]?.confidence);
    assert.equal(finding?.status, "proposed");
    assert.ok(result.text.includes("[Page 1]"));
    assert.ok(result.text.includes("[OCR confidence"));
  } finally {
    await rm(scan.directory, { recursive: true, force: true });
  }
});

test("OCRs an image-only PDF without applying findings", async () => {
  const scan = await makeScan();
  const pdfPath = path.join(scan.directory, "scan.pdf");
  try {
    await execFileAsync("magick", [scan.imagePath, pdfPath]);
    const result = await parseConstructionDocument("plans.pdf", "application/pdf", await readFile(pdfPath));
    assert.equal(result.parser, "pdfjs+tesseract");
    assert.equal(result.pageCount, 1);
    assert.equal(result.needsReview, true);
    assert.ok(result.findings.every((finding) => finding.status === "proposed"));
    assert.ok(result.findings.some((finding) => finding.page === 1 && finding.evidence.includes("OCR Test")));
  } finally {
    await rm(scan.directory, { recursive: true, force: true });
  }
});

test("keeps unreadable OCR and parser limits in review", async () => {
  const unsupported = await parseConstructionDocument("plans.dwg", "application/acad", Buffer.from("binary"));
  assert.equal(unsupported.status, undefined);
  assert.equal(unsupported.needsReview, true);
  const imageOnly = await parseConstructionDocument("scan.png", "image/png", Buffer.from("not an image"));
  assert.equal(imageOnly.needsReview, true);
  assert.equal(imageOnly.findings.length, 0);
  assert.match(imageOnly.warning ?? "", /OCR could not read|confidence is low/i);
  await assert.rejects(
    parseConstructionDocument("too-large.txt", "text/plain", Buffer.alloc(DOCUMENT_MAX_BYTES + 1)),
    /parsing limit/,
  );
  assert.equal(DOCUMENT_MAX_OCR_PAGES, 20);
  assert.equal(DOCUMENT_OCR_TIMEOUT_MS, 8_000);
});

test("infers document roles from filenames", () => {
  assert.equal(inferDocumentRole("Addendum 02.pdf"), "addendum");
  assert.equal(inferDocumentRole("A-101 floor plan.pdf"), "plans");
  assert.equal(inferDocumentRole("Division 09 specifications.docx"), "specifications");
  assert.equal(inferDocumentRole("bid invitation.pdf"), "itb_invitation");
});