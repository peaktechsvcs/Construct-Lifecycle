import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { unzipSync } from "fflate";

const execFileAsync = promisify(execFile);

export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_MAX_TEXT_CHARS = 150_000;
export const DOCUMENT_MAX_FINDINGS = 100;
export const DOCUMENT_MAX_OCR_PAGES = 20;
export const DOCUMENT_OCR_TIMEOUT_MS = 8_000;
export const DOCUMENT_OCR_MIN_CONFIDENCE = 0.65;
export const DOCUMENT_PARSE_TIMEOUT_MS = 30_000;
export const DOCUMENT_MAX_ATTEMPTS = 3;
export const DOCUMENT_PARSER_VERSION = "2";

export type DocumentRole = "itb_invitation" | "scope" | "plans" | "specifications" | "addendum" | "other";
export type DocumentFinding = {
  key: string;
  label: string;
  value: string;
  confidence: number;
  evidence: string;
  page?: number;
  ocrConfidence?: number;
  status: "proposed" | "accepted" | "rejected" | "corrected";
  correctedValue?: string | null;
};

export type DocumentPageEvidence = {
  page: number;
  text: string;
  confidence: number;
};

type ParsedDocument = {
  parser: string;
  text: string;
  pageCount: number | null;
  findings: DocumentFinding[];
  needsReview: boolean;
  pageEvidence: DocumentPageEvidence[];
  warning?: string;
};

const textTypes = new Set(["text/plain", "text/csv", "application/csv"]);
const imageTypes = new Set(["image/gif", "image/jpeg", "image/png", "image/tiff"]);
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

type OcrPage = DocumentPageEvidence;

const boundedConfidence = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error("Document parsing timed out");
};

async function runTesseract(inputPath: string, page: number, signal?: AbortSignal): Promise<OcrPage> {
  throwIfAborted(signal);
  const { stdout } = await execFileAsync(
    "tesseract",
    [inputPath, "stdout", "--psm", "6", "tsv"],
    { timeout: DOCUMENT_OCR_TIMEOUT_MS, maxBuffer: 2_000_000, signal },
  );
  const lines = stdout.split(/\r?\n/).slice(1);
  const grouped = new Map<string, { words: string[]; confidence: number[] }>();
  for (const line of lines) {
    const columns = line.split("\t");
    if (columns.length < 12) continue;
    const text = columns.slice(11).join("\t").trim();
    if (!text) continue;
    const key = `${columns[2]}:${columns[3]}:${columns[4]}`;
    const entry = grouped.get(key) ?? { words: [], confidence: [] };
    entry.words.push(text);
    const confidence = Number(columns[10]);
    if (confidence >= 0) entry.confidence.push(boundedConfidence(confidence / 100));
    grouped.set(key, entry);
  }
  const text = [...grouped.values()].map((line) => line.words.join(" ")).join("\n");
  const confidences = [...grouped.values()].flatMap((line) => line.confidence);
  const confidence = confidences.length === 0
    ? 0
    : confidences.reduce((total, value) => total + value, 0) / confidences.length;
  return { page, text: bounded(text), confidence: boundedConfidence(confidence) };
}

async function withOcrDirectory<T>(callback: (directory: string) => Promise<T>) {
  const directory = await mkdtemp(path.join(tmpdir(), "clc-itb-ocr-"));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function ocrImage(bytes: Uint8Array, extension: string, signal?: AbortSignal): Promise<OcrPage[]> {
  return withOcrDirectory(async (directory) => {
    throwIfAborted(signal);
    const inputPath = path.join(directory, `input.${extension}`);
    await writeFile(inputPath, bytes);
    return [await runTesseract(inputPath, 1, signal)];
  });
}

async function ocrPdf(bytes: Uint8Array, pageCount: number, signal?: AbortSignal): Promise<OcrPage[]> {
  return withOcrDirectory(async (directory) => {
    throwIfAborted(signal);
    const inputPath = path.join(directory, "input.pdf");
    await writeFile(inputPath, bytes);
    const pages: OcrPage[] = [];
    const pageLimit = Math.min(pageCount, DOCUMENT_MAX_OCR_PAGES);
    for (let page = 1; page <= pageLimit; page += 1) {
      throwIfAborted(signal);
      const outputPrefix = path.join(directory, `page-${page}`);
      await execFileAsync(
        "pdftoppm",
        ["-f", String(page), "-l", String(page), "-r", "150", "-png", "-singlefile", inputPath, outputPrefix],
        { timeout: DOCUMENT_OCR_TIMEOUT_MS, maxBuffer: 1_000_000, signal },
      );
      pages.push(await runTesseract(`${outputPrefix}.png`, page, signal));
    }
    return pages;
  });
}

const ocrText = (pages: OcrPage[]) => pages
  .map((page) => `[Page ${page.page}]\n[OCR confidence ${page.confidence.toFixed(2)}]\n${page.text}`)
  .join("\n");

const ocrWarning = (pages: OcrPage[], pageCount?: number) => {
  if (pages.length === 0 || pages.some((page) => !page.text || page.confidence < DOCUMENT_OCR_MIN_CONFIDENCE)) {
    return "OCR confidence is low or a page was unreadable. Review the source document before using any findings.";
  }
  if (pageCount && pageCount > DOCUMENT_MAX_OCR_PAGES) {
    return `OCR reviewed the first ${DOCUMENT_MAX_OCR_PAGES} pages of ${pageCount}; remaining pages require review.`;
  }
  return "OCR output requires human review before it can be applied.";
};

async function parsePdf(bytes: Uint8Array, signal?: AbortSignal): Promise<Pick<ParsedDocument, "parser" | "text" | "pageCount" | "pageEvidence" | "warning">> {
  // pdfjs-dist is intentionally loaded only for PDF inputs; unsupported worker/font
  // features are disabled because this is bounded server-side text extraction.
  throwIfAborted(signal);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages && pages.join("\n").length < DOCUMENT_MAX_TEXT_CHARS; pageNumber += 1) {
    throwIfAborted(signal);
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    pages.push(`[Page ${pageNumber}]\n${pageText}`);
  }
  const text = bounded(pages.join("\n"));
  if (text.replace(/\[Page \d+\]/g, "").trim().length >= 20) {
    return { parser: "pdfjs", text, pageCount: document.numPages, pageEvidence: [] };
  }
  try {
    const pageEvidence = await ocrPdf(bytes, document.numPages, signal);
    return {
      parser: "pdfjs+tesseract",
      text: bounded(ocrText(pageEvidence)),
      pageCount: document.numPages,
      pageEvidence,
      warning: ocrWarning(pageEvidence, document.numPages),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      parser: "pdfjs+tesseract",
      text: "",
      pageCount: document.numPages,
      pageEvidence: [],
      warning: "OCR could not read this scanned PDF. The document remains available for manual review.",
    };
  }
}

function parseOffice(bytes: Uint8Array, extension: string) {
  if (extension === "docx") {
    return { parser: "docx-xml", text: bounded(xmlText(unzipText(bytes, [/word\/document\.xml$/, /word\/header\d*\.xml$/, /word\/footer\d*\.xml$/]))), pageCount: null };
  }
  const workbook = unzipText(bytes, [/xl\/sharedStrings\.xml$/, /xl\/worksheets\/sheet\d+\.xml$/]);
  return { parser: "xlsx-xml", text: bounded(xmlText(workbook)), pageCount: null };
}

function makeFindings(text: string, pageConfidence = new Map<number, number>()): DocumentFinding[] {
  const records: Array<{ line: string; page?: number }> = [];
  let currentPage: number | undefined;
  for (const rawLine of text.split("\n")) {
    const line = normalize(rawLine);
    if (!line) continue;
    const pageMatch = line.match(/^\[Page (\d+)\]/);
    if (pageMatch) {
      currentPage = Number(pageMatch[1]);
      continue;
    }
    if (/^\[OCR confidence \d+(?:\.\d+)?\]$/.test(line)) continue;
    records.push({ line, page: currentPage });
  }
  const lines = records.map((record) => record.line);
  const findings: DocumentFinding[] = [];
  const add = (key: string, label: string, value: string | undefined, confidence: number, evidence: string, page?: number) => {
    const clean = value?.trim().slice(0, 500);
    if (!clean || findings.length >= DOCUMENT_MAX_FINDINGS) return;
    const ocrConfidence = page ? pageConfidence.get(page) : undefined;
    findings.push({
      key,
      label,
      value: clean,
      confidence: ocrConfidence === undefined ? confidence : Math.min(confidence, ocrConfidence),
      evidence: evidence.slice(0, 700),
      ...(page ? { page } : {}),
      ...(ocrConfidence === undefined ? {} : { ocrConfidence }),
      status: "proposed",
      correctedValue: null,
    });
  };
  const labeled = (labels: string[], key: string, label: string, confidence = 0.88) => {
    const pattern = new RegExp(`^\\s*(?:${labels.join("|")})\\s*[:\\-]\\s*(.+)$`, "i");
    const match = records.find((record) => pattern.test(record.line));
    if (match) add(key, label, match.line.replace(pattern, "$1"), confidence, match.line, match.page);
  };
  labeled(["project", "project name", "project title"], "project_name", "Project name");
  labeled(["owner", "issuer", "inviting party", "general contractor"], "issuer", "Issuing organization");
  labeled(["bid due", "bid deadline", "due date", "deadline", "submission deadline"], "bid_due_date", "Bid due date");
  labeled(["location", "project location", "site"], "location", "Project location");
  labeled(["estimated value", "budget", "contract value"], "estimated_value", "Estimated value", 0.8);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email) {
    const emailRecord = records.find((record) => record.line.includes(email));
    add("contact_email", "Contact email", email, 0.98, email, emailRecord?.page);
  }
  const requirements = records.filter(({ line }) => /\b(must|required|required to|submit|include|insurance|bond|warranty|prequalification)\b/i.test(line)).slice(0, 20);
  requirements.forEach((record, index) => add(`requirement_${index + 1}`, "Requirement", record.line, 0.7, record.line, record.page));
  const alternates = records.filter(({ line }) => /\b(alternate|option|additive|deduct)\b/i.test(line)).slice(0, 10);
  alternates.forEach((record, index) => add(`alternate_${index + 1}`, "Alternate", record.line, 0.68, record.line, record.page));
  return findings;
}

export async function parseConstructionDocument(
  name: string,
  contentType: string,
  bytes: Buffer,
  options: { signal?: AbortSignal } = {},
): Promise<ParsedDocument> {
  const { signal } = options;
  if (bytes.length > DOCUMENT_MAX_BYTES) throw new Error(`Document exceeds the ${DOCUMENT_MAX_BYTES} byte parsing limit`);
  const extension = name.toLowerCase().split(".").pop() ?? "";
  let parsed: Pick<ParsedDocument, "parser" | "text" | "pageCount" | "pageEvidence" | "warning">;
  if (contentType === "application/pdf" || extension === "pdf") {
    parsed = await parsePdf(bytes, signal);
  } else if (imageTypes.has(contentType)) {
    try {
      const pageEvidence = await ocrImage(bytes, extension || "img", signal);
      parsed = {
        parser: "tesseract",
        text: bounded(ocrText(pageEvidence)),
        pageCount: 1,
        pageEvidence,
        warning: ocrWarning(pageEvidence, 1),
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      parsed = {
        parser: "tesseract",
        text: "",
        pageCount: 1,
        pageEvidence: [],
        warning: "OCR could not read this image. The document remains available for manual review.",
      };
    }
  } else if (textTypes.has(contentType) || ["txt", "csv"].includes(extension)) {
    parsed = { parser: "text", text: bounded(new TextDecoder().decode(bytes)), pageCount: null, pageEvidence: [] };
  } else if (["docx", "xlsx"].includes(extension) || contentType.includes("wordprocessingml") || contentType.includes("spreadsheetml")) {
    parsed = {
      ...parseOffice(bytes, extension === "xlsx" || contentType.includes("spreadsheetml") ? "xlsx" : "docx"),
      pageEvidence: [],
    };
  } else {
    return { parser: "unsupported", text: "", pageCount: null, findings: [], needsReview: true, pageEvidence: [], warning: "This file type is not supported for text extraction." };
  }
  const text = bounded(parsed.text);
  if (text.length < 20) {
    return { ...parsed, text, findings: [], needsReview: true, warning: parsed.warning ?? "No readable text was found. The document may be image-only or encrypted." };
  }
  const pageConfidence = new Map(parsed.pageEvidence.map((page) => [page.page, page.confidence]));
  return {
    ...parsed,
    text,
    findings: makeFindings(text, pageConfidence),
    needsReview: parsed.pageEvidence.length > 0,
    warning: parsed.warning,
  };
}

export const documentSha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const inferDocumentRole = rolePattern;