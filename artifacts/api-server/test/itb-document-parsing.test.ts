import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
import {
  DOCUMENT_MAX_TEXT_CHARS,
  inferDocumentRole,
  parseConstructionDocument,
} from "../src/lib/itb-document-parsing.ts";

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

test("marks unsupported and image-only documents for review", async () => {
  const unsupported = await parseConstructionDocument("plans.dwg", "application/acad", Buffer.from("binary"));
  assert.equal(unsupported.status, undefined);
  assert.equal(unsupported.needsReview, true);
  const imageOnly = await parseConstructionDocument("scan.txt", "text/plain", Buffer.from("\u0000\u0000"));
  assert.equal(imageOnly.needsReview, true);
});

test("infers document roles from filenames", () => {
  assert.equal(inferDocumentRole("Addendum 02.pdf"), "addendum");
  assert.equal(inferDocumentRole("A-101 floor plan.pdf"), "plans");
  assert.equal(inferDocumentRole("Division 09 specifications.docx"), "specifications");
  assert.equal(inferDocumentRole("bid invitation.pdf"), "itb_invitation");
});