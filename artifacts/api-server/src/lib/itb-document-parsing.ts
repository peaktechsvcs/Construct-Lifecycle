import { createHash } from "node:crypto";
import { unzipSync } from "fflate";

export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_MAX_TEXT_CHARS = 150_000;
export const DOCUMENT_MAX_FINDINGS = 100;
export const DOCUMENT_PARSER_VERSION = "1";

export type DocumentRole = "itb_invitation" | "scope" | "plans" | "specifications" | "addendum" | "other";
export type DocumentFinding = {
  key: string;
  label: string;
  value: string;
  confidence: number;
  evidence: string;
  page?: number;
  status: "proposed" | "accepted" | "rejected" | "corrected";
  correctedValue?: string | null;
};

type ParsedDocument = {
  parser: string;
  text: string;
  pageCount: number | null;
  findings: DocumentFinding[];
  needsReview: boolean;
  warning?: string;
};

const textTypes = new Set(["text/plain", "text/csv", "application/csv"]);
const rolePattern = (name: string): DocumentRole => {
  const value = name.toLowerCase();
  if (/(addendum|amendment|revision)/.test(value)) return "addendum";
  if (/(plan|drawing|sheet|blueprint)/.test(value)) return "plans";
  if (/(spec|division|section)/.test(value)) return "specifications";
  if (/(scope|sow|statement-of-work)/.test(value)) return "scope";
  if (/(bid|invite|invitation|itb|rfq|proposal-request)/.test(value)) return "itb_invitation";
  return "other";
};

const normalize = (value: string) => value.replace(/\u0000/g, "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
const bounded = (value: string) => normalize(value).slice(0, DOCUMENT_MAX_TEXT_CHARS);
const decodeXml = (value: string) => value
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const xmlText = (value: string) => decodeXml(value.replace(/<w:tab[^>]*\/>/g, "\t").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));

function unzipText(bytes: Uint8Array, names: RegExp[]) {
  const entries = unzipSync(bytes);
  const selected = Object.entries(entries).filter(([name]) => names.some((pattern) => pattern.test(name)));
  if (selected.length > 2_000) throw new Error("Archive contains too many entries");
  return selected.map(([, content]) => new TextDecoder().decode(content)).join("\n");
}

async function parsePdf(bytes: Uint8Array): Promise<Pick<ParsedDocument, "parser" | "text" | "pageCount">> {
  // pdfjs-dist is intentionally loaded only for PDF inputs; unsupported worker/font
  // features are disabled because this is bounded server-side text extraction.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages && pages.join("\n").length < DOCUMENT_MAX_TEXT_CHARS; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    pages.push(`[Page ${pageNumber}]\n${pageText}`);
  }
  return { parser: "pdfjs", text: bounded(pages.join("\n")), pageCount: document.numPages };
}

function parseOffice(bytes: Uint8Array, extension: string) {
  if (extension === "docx") {
    return { parser: "docx-xml", text: bounded(xmlText(unzipText(bytes, [/word\/document\.xml$/, /word\/header\d*\.xml$/, /word\/footer\d*\.xml$/]))), pageCount: null };
  }
  const workbook = unzipText(bytes, [/xl\/sharedStrings\.xml$/, /xl\/worksheets\/sheet\d+\.xml$/]);
  return { parser: "xlsx-xml", text: bounded(xmlText(workbook)), pageCount: null };
}

function makeFindings(text: string): DocumentFinding[] {
  const lines = text.split("\n").map(normalize).filter(Boolean);
  const findings: DocumentFinding[] = [];
  const add = (key: string, label: string, value: string | undefined, confidence: number, evidence: string, page?: number) => {
    const clean = value?.trim().slice(0, 500);
    if (!clean || findings.length >= DOCUMENT_MAX_FINDINGS) return;
    findings.push({ key, label, value: clean, confidence, evidence: evidence.slice(0, 700), ...(page ? { page } : {}), status: "proposed", correctedValue: null });
  };
  const labeled = (labels: string[], key: string, label: string, confidence = 0.88) => {
    const pattern = new RegExp(`^\\s*(?:${labels.join("|")})\\s*[:\\-]\\s*(.+)$`, "i");
    const match = lines.find((line) => pattern.test(line));
    if (match) add(key, label, match.replace(pattern, "$1"), confidence, match, Number(match.match(/\[Page (\d+)\]/)?.[1]) || undefined);
  };
  labeled(["project", "project name", "project title"], "project_name", "Project name");
  labeled(["owner", "issuer", "inviting party", "general contractor"], "issuer", "Issuing organization");
  labeled(["bid due", "bid deadline", "due date", "deadline", "submission deadline"], "bid_due_date", "Bid due date");
  labeled(["location", "project location", "site"], "location", "Project location");
  labeled(["estimated value", "budget", "contract value"], "estimated_value", "Estimated value", 0.8);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email) add("contact_email", "Contact email", email, 0.98, email);
  const requirements = lines.filter((line) => /\b(must|required|required to|submit|include|insurance|bond|warranty|prequalification)\b/i.test(line)).slice(0, 20);
  requirements.forEach((line, index) => add(`requirement_${index + 1}`, "Requirement", line, 0.7, line));
  const alternates = lines.filter((line) => /\b(alternate|option|additive|deduct)\b/i.test(line)).slice(0, 10);
  alternates.forEach((line, index) => add(`alternate_${index + 1}`, "Alternate", line, 0.68, line));
  return findings;
}

export async function parseConstructionDocument(name: string, contentType: string, bytes: Buffer): Promise<ParsedDocument> {
  if (bytes.length > DOCUMENT_MAX_BYTES) throw new Error(`Document exceeds the ${DOCUMENT_MAX_BYTES} byte parsing limit`);
  const extension = name.toLowerCase().split(".").pop() ?? "";
  let parsed: Pick<ParsedDocument, "parser" | "text" | "pageCount">;
  if (contentType === "application/pdf" || extension === "pdf") {
    parsed = await parsePdf(bytes);
  } else if (textTypes.has(contentType) || ["txt", "csv"].includes(extension)) {
    parsed = { parser: "text", text: bounded(new TextDecoder().decode(bytes)), pageCount: null };
  } else if (["docx", "xlsx"].includes(extension) || contentType.includes("wordprocessingml") || contentType.includes("spreadsheetml")) {
    parsed = parseOffice(bytes, extension === "xlsx" || contentType.includes("spreadsheetml") ? "xlsx" : "docx");
  } else {
    return { parser: "unsupported", text: "", pageCount: null, findings: [], needsReview: true, warning: "This file type is not supported for text extraction." };
  }
  const text = bounded(parsed.text);
  if (text.length < 20) {
    return { ...parsed, text, findings: [], needsReview: true, warning: "No readable text was found. The document may be image-only or encrypted." };
  }
  return { ...parsed, text, findings: makeFindings(text), needsReview: false };
}

export const documentSha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const inferDocumentRole = rolePattern;