import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  bidsTable,
  businessCustomersTable,
  db,
  itbDocumentEvidenceMappingsTable,
  itbIntakeAttachmentsTable,
  itbDocumentsTable,
  itbIntakesTable,
  itbMailboxCursorsTable,
  membershipsTable,
  opportunitiesTable,
  platformAuditEventsTable,
  projectsTable,
  usersTable,
} from "@workspace/db";
import {
  ApproveItbIntakeBody,
  CreateItbIntakeBody,
  GetItbIntakeParams,
  ImportItbMailboxMessageBody,
  ListItbIntakesQueryParams,
  MergeItbIntakeBody,
  RequestItbAttachmentUploadBody,
  UpdateItbIntakeBody,
  ProcessItbDocumentBody,
  RetryItbDocumentParams,
  ReviewItbDocumentFindingsBody,
  ReviewItbDocumentFindingsParams,
  ApplyItbDocumentFindingsParams,
  ListItbDocumentEvidenceMappingsParams,
  MapItbDocumentEvidenceParams,
  MapItbDocumentEvidenceBody,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { extractItb as extractItbFromSource } from "../lib/itb-extraction";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_ATTEMPTS,
  DOCUMENT_PARSE_TIMEOUT_MS,
  DOCUMENT_PARSER_VERSION,
  documentSha256,
  inferDocumentRole,
  parseConstructionDocument,
  type DocumentFinding,
} from "../lib/itb-document-parsing";
import { createItbMailboxClient, type MailboxProvider } from "../lib/itb-mailbox";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const connectors = new ReplitConnectors();
const mailboxClient = createItbMailboxClient(connectors);
const MAX_SOURCE_CHARS = 200_000;
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const extractionKeys = ["issuer", "contactName", "contactEmail", "contactPhone", "projectName", "location", "dueDate", "scope", "requirements", "alternates", "estimatedValue"] as const;
type ExtractedField = { value: string | null; confidence: number; evidence: string };
type Extraction = {
  issuer: ExtractedField;
  contactName: ExtractedField;
  contactEmail: ExtractedField;
  contactPhone: ExtractedField;
  projectName: ExtractedField;
  location: ExtractedField;
  dueDate: ExtractedField;
  scope: ExtractedField[];
  requirements: ExtractedField[];
  alternates: ExtractedField[];
  estimatedValue: ExtractedField;
};

const emptyField = (): ExtractedField => ({ value: null, confidence: 0, evidence: "Not detected in the source." });
const clean = (value: string | undefined | null, max = 500) => value?.replace(/\s+/g, " ").trim().slice(0, max) || null;
const evidence = (value: string) => clean(value, 700) ?? "";
const field = (value: string | null, confidence: number, source: string) => ({ value: clean(value), confidence, evidence: evidence(source) });
const headerValue = (headers: Array<{ name?: string; value?: string }> | undefined, name: string) =>
  headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

const parseDate = (value: string) => {
  const normalized = value.replace(/(\d)(st|nd|rd|th)\b/gi, "$1").trim();
  const iso = normalized.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = normalized.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed.toISOString().slice(0, 10);
};

const extractLabeled = (text: string, labels: string[]) => {
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:${labels.join("|")})\\s*[:\\-]\\s*([^\\n]+)`, "i");
  const match = text.match(pattern);
  return match ? { value: clean(match[1]), source: match[0] } : null;
};

const extractEmail = (text: string) => text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? null;
const extractPhone = (text: string) => text.match(/(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}\b/)?.[0] ?? null;

const moneyToNumber = (value: string | null) => {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)\s*([kmb])?/i);
  if (!match) return null;
  const multiplier = match[2]?.toLowerCase() === "k" ? 1_000 : match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "b" ? 1_000_000_000 : 1;
  return String(Math.round(Number(match[1]) * multiplier * 100) / 100);
};

export function extractItb(sourceSubject: string | null, sourceBody: string) {
  const text = `${sourceSubject ? `Subject: ${sourceSubject}\n` : ""}${sourceBody}`.slice(0, MAX_SOURCE_CHARS);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labeledIssuer = extractLabeled(text, ["issuer", "owner", "general contractor", "gc"]);
  const labeledProject = extractLabeled(text, ["project", "project name", "job name"]);
  const labeledLocation = extractLabeled(text, ["location", "jobsite", "job site", "site address", "project address"]);
  const labeledContact = extractLabeled(text, ["contact", "contact name"]);
  const labeledDue = extractLabeled(text, ["bid due", "due date", "proposal due", "bids due", "deadline"]);
  const labeledValue = extractLabeled(text, ["estimated value", "project value", "budget", "estimate"]);
  const subjectProject = clean(sourceSubject?.replace(/^(re:\s*)?(itb|invitation to bid|request for proposal|rfp)\s*[:\-#]?\s*/i, ""));
  const dateMatch = text.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*|\s+)20\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]20\d{2}\b|\b20\d{2}-\d{1,2}-\d{1,2}\b/i);
  const dueDate = labeledDue ? parseDate(labeledDue.value ?? "") : dateMatch ? parseDate(dateMatch[0]) : null;
  const moneyMatch = (labeledValue?.value ?? text.match(/\$\s*\d[\d,.]*(?:\s*[kmb])?/i)?.[0] ?? null);
  const scopeTerms = ["concrete", "masonry", "steel", "carpentry", "drywall", "flooring", "roofing", "glazing", "doors", "millwork", "painting", "plumbing", "hvac", "electrical", "sitework", "landscaping", "earthwork", "fire protection"];
  const scopes = scopeTerms.filter((term) => new RegExp(`\\b${term}\\b`, "i").test(text)).slice(0, 12);
  const requirementLines = lines.filter((line) => /\b(require|must|submit|insurance|bond|warranty|prevailing|schedule|prequalification|prequalification)\b/i.test(line)).slice(0, 8);
  const alternateLines = lines.filter((line) => /\b(alternate|option|additive|deduct)\b/i.test(line)).slice(0, 8);
  const makeList = (values: string[], confidence: number) => values.map((value) => field(value, confidence, value));
  const extraction: Extraction = {
    issuer: field(labeledIssuer?.value ?? null, labeledIssuer ? 0.93 : 0, labeledIssuer?.source ?? "No issuer label found."),
    contactName: field(labeledContact?.value ?? null, labeledContact ? 0.9 : 0, labeledContact?.source ?? "No contact label found."),
    contactEmail: field(extractEmail(text), extractEmail(text) ? 0.98 : 0, extractEmail(text) ?? "No email address found."),
    contactPhone: field(extractPhone(text), extractPhone(text) ? 0.86 : 0, extractPhone(text) ?? "No phone number found."),
    projectName: field(labeledProject?.value ?? subjectProject, labeledProject ? 0.94 : subjectProject ? 0.72 : 0, labeledProject?.source ?? (subjectProject ? `Subject: ${subjectProject}` : "No project name found.")),
    location: field(labeledLocation?.value ?? null, labeledLocation ? 0.91 : 0, labeledLocation?.source ?? "No location label found."),
    dueDate: field(dueDate, dueDate ? (labeledDue ? 0.97 : 0.7) : 0, labeledDue?.source ?? dateMatch?.[0] ?? "No bid deadline found."),
    scope: makeList(scopes, 0.67),
    requirements: makeList(requirementLines, 0.72),
    alternates: makeList(alternateLines, 0.72),
    estimatedValue: field(moneyToNumber(moneyMatch), moneyMatch ? (labeledValue ? 0.9 : 0.6) : 0, labeledValue?.source ?? moneyMatch ?? "No estimated value found."),
  };
  const warnings = extractionKeys.filter((key) => Array.isArray(extraction[key]) ? extraction[key].length === 0 : !extraction[key].value)
    .map((key) => `No ${key.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`)} was confidently detected.`);
  return { extraction, warnings };
}

const json = <T>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
};

const publicExtraction = (row: typeof itbIntakesTable.$inferSelect): Extraction => json(row.extractionJson, {
  issuer: emptyField(), contactName: emptyField(), contactEmail: emptyField(), contactPhone: emptyField(),
  projectName: emptyField(), location: emptyField(), dueDate: emptyField(), scope: [], requirements: [], alternates: [], estimatedValue: emptyField(),
});

const serialize = (row: typeof itbIntakesTable.$inferSelect, attachments: Array<typeof itbIntakeAttachmentsTable.$inferSelect>) => ({
  id: row.id,
  tenantId: row.tenantId,
  environmentId: row.environmentId,
  sourceType: row.sourceType,
  sourceProvider: row.sourceProvider,
  sourceMessageId: row.sourceMessageId,
  sourceThreadId: row.sourceThreadId,
  sourceMailbox: row.sourceMailbox,
  sourceSender: row.sourceSender,
  sourceSenderEmail: row.sourceSenderEmail,
  sourceSubject: row.sourceSubject,
  sourceReceivedAt: row.sourceReceivedAt,
  sourceBody: row.sourceBody,
  status: row.status,
  extractionStatus: row.extractionStatus,
  extraction: publicExtraction(row),
  warnings: json<string[]>(row.extractionWarningsJson, []),
  errorMessage: row.errorMessage,
  businessCustomerId: row.businessCustomerId,
  opportunityId: row.opportunityId,
  bidId: row.bidId,
  mergedIntoId: row.mergedIntoId,
  reviewedAt: row.reviewedAt,
  attachments: attachments.map((attachment) => ({
    id: attachment.id,
    originalName: attachment.originalName,
    contentType: attachment.contentType,
    size: attachment.size,
    sourceAttachmentId: attachment.sourceAttachmentId,
    downloadUrl: `/api/itb-intakes/${row.id}/attachments/${attachment.id}`,
    createdAt: attachment.createdAt,
  })),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const getIntake = async (req: TenantRequest, id: number) => {
  const [row] = await db.select().from(itbIntakesTable).where(and(
    eq(itbIntakesTable.id, id),
    eq(itbIntakesTable.tenantId, req.tenantId!),
    eq(itbIntakesTable.environmentId, req.environmentId!),
  )).limit(1);
  return row;
};

const getAttachments = async (intakeId: number) => db.select().from(itbIntakeAttachmentsTable)
  .where(eq(itbIntakeAttachmentsTable.intakeId, intakeId)).orderBy(asc(itbIntakeAttachmentsTable.createdAt));

const fingerprint = (parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex");
const privatePrefix = () => {
  const privateDir = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!privateDir) return "/objects/";
  const normalized = privateDir.startsWith("/") ? privateDir : `/${privateDir}`;
  const [, ...objectParts] = normalized.split("/").slice(1);
  const objectPrefix = objectParts.filter(Boolean).join("/");
  return `/objects/${objectPrefix ? `${objectPrefix}/` : ""}itb-intakes/`;
};
const isOwnedItbObject = (path: string) => path.startsWith(privatePrefix()) && path.length > privatePrefix().length;

const validateCustomer = async (req: TenantRequest, customerId: number) => {
  const [customer] = await db.select({ id: businessCustomersTable.id }).from(businessCustomersTable).where(and(
    eq(businessCustomersTable.id, customerId),
    eq(businessCustomersTable.tenantId, req.tenantId!),
    eq(businessCustomersTable.environmentId, req.environmentId!),
    eq(businessCustomersTable.status, "active"),
  )).limit(1);
  return Boolean(customer);
};

const validateOwner = async (req: TenantRequest, ownerUserId: number | null | undefined) => {
  if (!ownerUserId) return true;
  const [member] = await db.select({ userId: membershipsTable.userId }).from(membershipsTable).where(and(
    eq(membershipsTable.tenantId, req.tenantId!),
    eq(membershipsTable.userId, ownerUserId),
  )).limit(1);
  return Boolean(member);
};

const parseMailboxProvider = (value: unknown): MailboxProvider | null => {
  if (value === "google-mail" || value === "outlook") return value;
  return null;
};

router.get("/itb-intakes", async (req: TenantRequest, res) => {
  const parsed = ListItbIntakesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ITB intake filters" });
    return;
  }
  const conditions = [
    eq(itbIntakesTable.tenantId, req.tenantId!),
    eq(itbIntakesTable.environmentId, req.environmentId!),
  ];
  if (parsed.data.status) conditions.push(eq(itbIntakesTable.status, parsed.data.status));
  if (parsed.data.sourceType) conditions.push(eq(itbIntakesTable.sourceType, parsed.data.sourceType));
  if (parsed.data.search) {
    const term = `%${parsed.data.search}%`;
    conditions.push(or(
      ilike(itbIntakesTable.sourceSubject, term),
      ilike(itbIntakesTable.sourceSender, term),
      ilike(itbIntakesTable.sourceSenderEmail, term),
      ilike(itbIntakesTable.extractionJson, term),
    )!);
  }
  const rows = await db.select().from(itbIntakesTable).where(and(...conditions)).orderBy(desc(itbIntakesTable.updatedAt)).limit(200);
  const attachments = rows.length
    ? await db.select().from(itbIntakeAttachmentsTable).where(sql`${itbIntakeAttachmentsTable.intakeId} in (${sql.join(rows.map((row) => sql`${row.id}`), sql`, `)})`)
    : [];
  res.json(rows.map((row) => serialize(row, attachments.filter((attachment) => attachment.intakeId === row.id))));
});

router.post("/itb-intakes", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateItbIntakeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ITB intake", details: parsed.error.issues });
    return;
  }
  if (parsed.data.sourceBody.length > MAX_SOURCE_CHARS) {
    res.status(413).json({ error: "Source content is too large" });
    return;
  }
  for (const attachment of parsed.data.attachments ?? []) {
    if (attachment.size > MAX_ATTACHMENT_BYTES || !isOwnedItbObject(attachment.objectPath)) {
      res.status(400).json({ error: "Attachment must use a protected ITB upload URL" });
      return;
    }
  }
  const sourceFingerprint = fingerprint([
    parsed.data.sourceType,
    parsed.data.sourceProvider ?? "",
    parsed.data.sourceMessageId ?? "",
    parsed.data.sourceThreadId ?? "",
    parsed.data.sourceSubject ?? "",
    parsed.data.sourceBody,
  ]);
  const existing = await db.select({ id: itbIntakesTable.id }).from(itbIntakesTable).where(and(
    eq(itbIntakesTable.tenantId, req.tenantId!),
    eq(itbIntakesTable.environmentId, req.environmentId!),
    eq(itbIntakesTable.sourceFingerprint, sourceFingerprint),
  )).limit(1);
  if (existing.length) {
    res.status(409).json({ error: "This source has already been imported", intakeId: existing[0].id });
    return;
  }
  const { extraction, warnings } = extractItbFromSource(parsed.data.sourceSubject ?? null, parsed.data.sourceBody);
  const [created] = await db.insert(itbIntakesTable).values({
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
    sourceType: parsed.data.sourceType,
    sourceProvider: parsed.data.sourceProvider ?? null,
    sourceMessageId: parsed.data.sourceMessageId ?? null,
    sourceThreadId: parsed.data.sourceThreadId ?? null,
    sourceFingerprint,
    sourceMailbox: parsed.data.sourceMailbox ?? null,
    sourceSender: parsed.data.sourceSender ?? null,
    sourceSenderEmail: parsed.data.sourceSenderEmail?.toLowerCase() ?? null,
    sourceSubject: parsed.data.sourceSubject ?? null,
    sourceReceivedAt: parsed.data.sourceReceivedAt ? new Date(parsed.data.sourceReceivedAt) : null,
    sourceBody: parsed.data.sourceBody,
    extractionJson: JSON.stringify(extraction),
    extractionWarningsJson: JSON.stringify(warnings),
    createdByUserId: req.localUserId!,
  }).returning();
  if (parsed.data.attachments?.length) {
    await db.insert(itbIntakeAttachmentsTable).values(parsed.data.attachments.map((attachment) => ({
      intakeId: created.id,
      originalName: attachment.originalName,
      contentType: attachment.contentType,
      size: attachment.size,
      objectPath: attachment.objectPath,
      sourceAttachmentId: attachment.sourceAttachmentId ?? null,
    })));
  }
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId: req.tenantId!,
    action: "itb_intake_created",
    details: JSON.stringify({ intakeId: created.id, sourceType: created.sourceType, environmentId: req.environmentId }),
  });
  res.status(201).json(serialize(created, await getAttachments(created.id)));
});

router.post("/itb-intakes/attachments/request-upload", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = RequestItbAttachmentUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid attachment details" });
    return;
  }
  if (parsed.data.size > MAX_ATTACHMENT_BYTES) {
    res.status(413).json({ error: "Attachment exceeds the 100 MB limit" });
    return;
  }
  try {
    res.json(await objectStorage.requestUpload("itb-intakes"));
  } catch (error) {
    req.log.error({ err: error }, "ITB attachment upload signing failed");
    res.status(503).json({ error: "Protected attachment storage is unavailable" });
  }
});

router.get("/itb-intakes/mailbox/preview", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const rawQuery = typeof req.query.q === "string" ? req.query.q : "in:anywhere newer_than:30d";
  const q = rawQuery.replace(/[\r\n]/g, " ").trim().slice(0, 180) || "in:anywhere newer_than:30d";
  const pageSize = Math.min(20, Math.max(1, Number(req.query.pageSize ?? 10) || 10));
  const provider = req.query.provider === undefined ? "google-mail" : parseMailboxProvider(req.query.provider);
  if (!provider) {
    res.status(400).json({ error: "Unsupported mailbox provider" });
    return;
  }
  try {
    const [cursor] = await db.select().from(itbMailboxCursorsTable).where(and(
      eq(itbMailboxCursorsTable.tenantId, req.tenantId!),
      eq(itbMailboxCursorsTable.environmentId, req.environmentId!),
      eq(itbMailboxCursorsTable.provider, provider),
      eq(itbMailboxCursorsTable.mailbox, "me"),
      eq(itbMailboxCursorsTable.query, q),
    )).limit(1);
     const mailboxResult = await mailboxClient.preview(provider, q, pageSize, cursor?.nextPageToken ?? undefined);
    await db.insert(itbMailboxCursorsTable).values({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      provider,
      mailbox: "me",
      query: q,
       nextPageToken: mailboxResult.nextPageToken,
      lastSyncedAt: new Date(),
    }).onConflictDoUpdate({
      target: [
        itbMailboxCursorsTable.tenantId,
        itbMailboxCursorsTable.environmentId,
        itbMailboxCursorsTable.provider,
        itbMailboxCursorsTable.mailbox,
        itbMailboxCursorsTable.query,
      ],
      set: {
         nextPageToken: mailboxResult.nextPageToken,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      },
    });
     const previews = mailboxResult.previews;
    const sourceIds: string[] = previews.map((preview: { messageId: string }) => preview.messageId);
    if (sourceIds.length) {
      const imported = await db.select({ sourceMessageId: itbIntakesTable.sourceMessageId }).from(itbIntakesTable).where(and(
        eq(itbIntakesTable.tenantId, req.tenantId!),
        eq(itbIntakesTable.environmentId, req.environmentId!),
        eq(itbIntakesTable.sourceProvider, provider),
        sql`${itbIntakesTable.sourceMessageId} in (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)})`,
      ));
      const importedIds = new Set(imported.map((row) => row.sourceMessageId));
      for (const preview of previews) preview.imported = importedIds.has(preview.messageId);
    }
    res.json(previews);
  } catch (error) {
    const status = (error as { status?: number }).status;
    req.log.warn({ err: error, connectorStatus: status }, "ITB mailbox preview unavailable");
    res.status(424).json({ error: `${provider === "outlook" ? "Microsoft 365" : "Google Workspace"} mailbox is not connected or could not be read` });
  }
});

router.post("/itb-intakes/mailbox/import", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const parsed = ImportItbMailboxMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid mailbox message" });
    return;
  }
  const provider = parsed.data.provider ?? "google-mail";
  try {
    const message = await mailboxClient.importMessage(provider, parsed.data.threadId, parsed.data.messageId);
    const attachments: Array<{ originalName: string; contentType: string; size: number; objectPath: string; sourceAttachmentId: string }> = [];
    for (const attachment of message.attachments) {
      try {
        const stored = await objectStorage.storeBytes("itb-intakes", attachment.bytes, attachment.contentType);
        attachments.push({
          originalName: attachment.originalName,
          contentType: attachment.contentType,
          size: attachment.size,
          objectPath: stored.objectPath,
          sourceAttachmentId: attachment.sourceAttachmentId,
        });
      } catch (error) {
        req.log.warn({ err: error, attachmentName: attachment.originalName }, "ITB mailbox attachment could not be stored");
      }
    }
    const existing = await db.select().from(itbIntakesTable).where(and(
      eq(itbIntakesTable.tenantId, req.tenantId!),
      eq(itbIntakesTable.environmentId, req.environmentId!),
      eq(itbIntakesTable.sourceProvider, message.sourceProvider),
      eq(itbIntakesTable.sourceMessageId, message.sourceMessageId),
    )).limit(1);
    if (existing.length) {
      res.status(409).json({ error: "This mailbox message was already imported", intakeId: existing[0].id });
      return;
    }
    const { extraction, warnings } = extractItbFromSource(message.sourceSubject, message.sourceBody);
    const [created] = await db.insert(itbIntakesTable).values({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      sourceType: message.sourceType,
      sourceProvider: message.sourceProvider,
      sourceMessageId: message.sourceMessageId,
      sourceThreadId: message.sourceThreadId,
      sourceFingerprint: fingerprint([message.sourceProvider, message.sourceMessageId]),
      sourceSender: message.sourceSender,
      sourceSenderEmail: message.sourceSenderEmail,
      sourceSubject: message.sourceSubject,
      sourceReceivedAt: new Date(message.sourceReceivedAt),
      sourceBody: message.sourceBody,
      extractionJson: JSON.stringify(extraction),
      extractionWarningsJson: JSON.stringify(warnings),
      createdByUserId: req.localUserId!,
    }).returning();
    if (attachments.length) {
      await db.insert(itbIntakeAttachmentsTable).values(attachments.map((attachment) => ({ ...attachment, intakeId: created.id })));
    }
    await db.insert(platformAuditEventsTable).values({
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      action: "itb_mailbox_message_imported",
      details: JSON.stringify({ intakeId: created.id, messageId: message.sourceMessageId, provider: message.sourceProvider, environmentId: req.environmentId }),
    });
    res.status(201).json(serialize(created, await getAttachments(created.id)));
  } catch (error) {
    const status = (error as { status?: number }).status;
    req.log.warn({ err: error, connectorStatus: status }, "ITB mailbox import unavailable");
    res.status(status === 404 ? 404 : 424).json({ error: `${provider === "outlook" ? "Microsoft 365" : "Google Workspace"} message could not be imported` });
  }
});

router.get("/itb-intakes/:intakeId", async (req: TenantRequest, res) => {
  const parsed = GetItbIntakeParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid intake id" });
    return;
  }
  const row = await getIntake(req, parsed.data.intakeId);
  if (!row) {
    res.status(404).json({ error: "ITB intake not found" });
    return;
  }
  res.json(serialize(row, await getAttachments(row.id)));
});

router.patch("/itb-intakes/:intakeId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = GetItbIntakeParams.safeParse(req.params);
  const parsed = UpdateItbIntakeBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid ITB intake update" });
    return;
  }
  const row = await getIntake(req, params.data.intakeId);
  if (!row) {
    res.status(404).json({ error: "ITB intake not found" });
    return;
  }
  if (row.status === "approved") {
    res.status(409).json({ error: "Approved intakes cannot be edited" });
    return;
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.extraction) {
    const nextExtraction = parsed.data.extraction;
    updates.extractionJson = JSON.stringify(nextExtraction);
    updates.extractionWarningsJson = JSON.stringify(extractionKeys.filter((key) => Array.isArray(nextExtraction[key]) ? nextExtraction[key].length === 0 : !nextExtraction[key]?.value).map((key) => `No ${key} was supplied.`));
  }
  if (parsed.data.businessCustomerId !== undefined) {
    if (parsed.data.businessCustomerId !== null && !(await validateCustomer(req, parsed.data.businessCustomerId))) {
      res.status(400).json({ error: "Business customer is not in this environment" });
      return;
    }
    updates.businessCustomerId = parsed.data.businessCustomerId;
  }
  if (parsed.data.status) {
    if (parsed.data.status === "approved") {
      res.status(400).json({ error: "Use the approve action to approve an intake" });
      return;
    }
    updates.status = parsed.data.status;
    if (["rejected", "archived"].includes(parsed.data.status)) {
      updates.reviewedByUserId = req.localUserId!;
      updates.reviewedAt = new Date();
    }
  }
  if (parsed.data.errorMessage !== undefined) updates.errorMessage = parsed.data.errorMessage;
  const [updated] = await db.update(itbIntakesTable).set(updates).where(eq(itbIntakesTable.id, row.id)).returning();
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId: req.tenantId!,
    action: "itb_intake_updated",
    details: JSON.stringify({ intakeId: row.id, status: updated.status, environmentId: req.environmentId }),
  });
  res.json(serialize(updated, await getAttachments(updated.id)));
});

router.post("/itb-intakes/:intakeId/approve", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = GetItbIntakeParams.safeParse(req.params);
  const parsed = ApproveItbIntakeBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid ITB approval" });
    return;
  }
  const row = await getIntake(req, params.data.intakeId);
  if (!row) {
    res.status(404).json({ error: "ITB intake not found" });
    return;
  }
  if (row.status === "approved" || row.status === "archived" || row.status === "rejected") {
    res.status(409).json({ error: "This intake has already been resolved" });
    return;
  }
  if (!(await validateCustomer(req, parsed.data.businessCustomerId))) {
    res.status(400).json({ error: "Business customer is not in this environment" });
    return;
  }
  const ownerUserId = parsed.data.ownerUserId ?? req.localUserId ?? null;
  if (!(await validateOwner(req, ownerUserId))) {
    res.status(400).json({ error: "Owner must be a member of this workspace" });
    return;
  }
  const extraction = publicExtraction(row);
  const projectName = extraction.projectName.value || row.sourceSubject || `ITB intake ${row.id}`;
  const description = [
    extraction.issuer.value ? `Issuer: ${extraction.issuer.value}` : "",
    extraction.location.value ? `Location: ${extraction.location.value}` : "",
    extraction.scope.length ? `Scope: ${extraction.scope.map((item) => item.value).filter(Boolean).join(", ")}` : "",
    extraction.requirements.length ? `Requirements: ${extraction.requirements.map((item) => item.value).filter(Boolean).join("; ")}` : "",
  ].filter(Boolean).join("\n");
  const dueDate = extraction.dueDate.value;
  const estimatedValue = extraction.estimatedValue.value && Number.isFinite(Number(extraction.estimatedValue.value)) ? extraction.estimatedValue.value : "0";
  try {
    const updated = await db.transaction(async (tx) => {
      let opportunityId = row.opportunityId;
      if (parsed.data.createOpportunity) {
        if (parsed.data.opportunityId) {
          const [linked] = await tx.select({ id: opportunitiesTable.id }).from(opportunitiesTable).where(and(
            eq(opportunitiesTable.id, parsed.data.opportunityId),
            eq(opportunitiesTable.tenantId, req.tenantId!),
            eq(opportunitiesTable.environmentId, req.environmentId!),
            eq(opportunitiesTable.businessCustomerId, parsed.data.businessCustomerId),
          )).limit(1);
          if (!linked) throw new Error("Opportunity is not in this environment or customer");
          opportunityId = linked.id;
        } else {
          const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(opportunitiesTable).where(and(
            eq(opportunitiesTable.tenantId, req.tenantId!),
            eq(opportunitiesTable.environmentId, req.environmentId!),
          ));
          const [createdOpportunity] = await tx.insert(opportunitiesTable).values({
            opportunityNumber: `OP-${new Date().getFullYear()}-${String(Number(count) + 1).padStart(3, "0")}`,
            businessCustomerId: parsed.data.businessCustomerId,
            name: projectName,
            description: description || null,
            stage: "new",
            estimatedValue,
            expectedCloseDate: null,
            ownerUserId,
            leadSource: row.sourceType === "gmail" ? "itb_mailbox" : "itb_manual",
            contactName: extraction.contactName.value,
            contactEmail: extraction.contactEmail.value,
            contactPhone: extraction.contactPhone.value,
            tenantId: req.tenantId!,
            environmentId: req.environmentId!,
          }).returning();
          opportunityId = createdOpportunity.id;
        }
      }
      let bidId = row.bidId;
      if (parsed.data.createBid) {
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(bidsTable).where(and(
          eq(bidsTable.tenantId, req.tenantId!),
          eq(bidsTable.environmentId, req.environmentId!),
        ));
        const [createdBid] = await tx.insert(bidsTable).values({
          bidNumber: `BID-${new Date().getFullYear()}-${String(Number(count) + 1).padStart(3, "0")}`,
          businessCustomerId: parsed.data.businessCustomerId,
          opportunityId,
          name: parsed.data.bidName?.trim() || projectName,
          description: description || null,
          stage: "invited",
          bidType: "general",
          scopeMode: "full",
          estimatedValue,
          dueDate,
          ownerUserId,
          takeoffCoverage: "none",
          estimatingCoverage: "none",
          tenantId: req.tenantId!,
          environmentId: req.environmentId!,
        }).returning();
        bidId = createdBid.id;
      }
      const [saved] = await tx.update(itbIntakesTable).set({
        businessCustomerId: parsed.data.businessCustomerId,
        opportunityId,
        bidId,
        status: "approved",
        reviewedByUserId: req.localUserId!,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(itbIntakesTable.id, row.id)).returning();
      return saved;
    });
    await db.insert(platformAuditEventsTable).values({
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      action: "itb_intake_approved",
      details: JSON.stringify({ intakeId: row.id, opportunityId: updated.opportunityId, bidId: updated.bidId, environmentId: req.environmentId }),
    });
    res.json(serialize(updated, await getAttachments(updated.id)));
  } catch (error) {
    req.log.warn({ err: error, intakeId: row.id }, "ITB approval failed");
    res.status(409).json({ error: error instanceof Error ? error.message : "ITB approval could not be completed" });
  }
});

router.post("/itb-intakes/:intakeId/merge", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = GetItbIntakeParams.safeParse(req.params);
  const parsed = MergeItbIntakeBody.safeParse(req.body);
  if (!params.success || !parsed.success || params.data.intakeId === parsed.data.targetIntakeId) {
    res.status(400).json({ error: "Choose a different target intake" });
    return;
  }
  const source = await getIntake(req, params.data.intakeId);
  const target = await getIntake(req, parsed.data.targetIntakeId);
  if (!source || !target) {
    res.status(404).json({ error: "Source or target intake not found" });
    return;
  }
  if (source.status !== "review" || !["review", "failed"].includes(target.status)) {
    res.status(409).json({ error: "Only unresolved review records can be merged" });
    return;
  }
  try {
    const surviving = await db.transaction(async (tx) => {
      const mergedBody = [target.sourceBody, `\n\n--- Merged duplicate intake #${source.id} ---\n`, source.sourceBody].join("").slice(0, MAX_SOURCE_CHARS);
      const mergedWarnings = Array.from(new Set([
        ...json<string[]>(target.extractionWarningsJson, []),
        ...json<string[]>(source.extractionWarningsJson, []),
        `Merged from duplicate intake #${source.id}.`,
      ]));
      const [savedTarget] = await tx.update(itbIntakesTable).set({
        sourceBody: mergedBody,
        extractionWarningsJson: JSON.stringify(mergedWarnings),
        updatedAt: new Date(),
      }).where(eq(itbIntakesTable.id, target.id)).returning();
      await tx.update(itbIntakesTable).set({
        status: "archived",
        mergedIntoId: target.id,
        reviewedByUserId: req.localUserId!,
        reviewedAt: new Date(),
        errorMessage: `Merged into intake #${target.id}`,
        updatedAt: new Date(),
      }).where(eq(itbIntakesTable.id, source.id));
      const sourceAttachments = await tx.select().from(itbIntakeAttachmentsTable).where(eq(itbIntakeAttachmentsTable.intakeId, source.id));
      if (sourceAttachments.length) {
        await tx.update(itbIntakeAttachmentsTable).set({ intakeId: target.id }).where(eq(itbIntakeAttachmentsTable.intakeId, source.id));
      }
      return savedTarget;
    });
    await db.insert(platformAuditEventsTable).values({
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      action: "itb_intakes_merged",
      details: JSON.stringify({ sourceIntakeId: source.id, targetIntakeId: target.id, environmentId: req.environmentId }),
    });
    res.json(serialize(surviving, await getAttachments(surviving.id)));
  } catch (error) {
    req.log.error({ err: error, sourceIntakeId: source.id, targetIntakeId: target.id }, "ITB merge failed");
    res.status(409).json({ error: "The duplicate intakes could not be merged" });
  }
});

const documentJson = <T>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
};

const documentResponse = (document: typeof itbDocumentsTable.$inferSelect, attachment: typeof itbIntakeAttachmentsTable.$inferSelect) => ({
  id: document.id,
  tenantId: document.tenantId,
  environmentId: document.environmentId,
  intakeId: document.intakeId,
  attachmentId: document.attachmentId,
  originalName: attachment.originalName,
  contentType: attachment.contentType,
  downloadUrl: `/api/itb-intakes/${document.intakeId}/attachments/${attachment.id}`,
  role: document.role,
  status: document.status,
  parser: document.parser,
  parserVersion: document.parserVersion,
  sha256: document.sha256,
  byteSize: document.byteSize,
  pageCount: document.pageCount,
  findings: documentJson<DocumentFinding[]>(document.findingsJson, []),
  errorMessage: document.errorMessage,
  attemptCount: document.attemptCount,
  processedAt: document.processedAt,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
});

const getDocument = async (req: TenantRequest, intakeId: number, documentId: number) => {
  const [row] = await db.select({ document: itbDocumentsTable, attachment: itbIntakeAttachmentsTable })
    .from(itbDocumentsTable)
    .innerJoin(itbIntakeAttachmentsTable, eq(itbIntakeAttachmentsTable.id, itbDocumentsTable.attachmentId))
    .where(and(
      eq(itbDocumentsTable.id, documentId),
      eq(itbDocumentsTable.intakeId, intakeId),
      eq(itbDocumentsTable.tenantId, req.tenantId!),
      eq(itbDocumentsTable.environmentId, req.environmentId!),
    )).limit(1);
  return row;
};

const evidenceTargetFields = {
  opportunity: new Set(["name", "description", "estimatedValue", "expectedCloseDate", "contactName", "contactEmail", "contactPhone"]),
  bid: new Set(["name", "description", "estimatedValue", "dueDate"]),
  project: new Set(["projectName", "address", "requirementsSummary"]),
} as const;

const normalizeMappedValue = (targetField: string, rawValue: string) => {
  const value = rawValue.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!value) throw new Error("Mapped evidence cannot be empty");
  if (["estimatedValue", "contractValue"].includes(targetField)) {
    const match = value.replace(/,/g, "").match(/^\$?\s*(\d+(?:\.\d+)?)\s*([kmb])?$/i);
    if (!match) throw new Error(`Evidence for ${targetField} must be a number`);
    const multiplier = match[2]?.toLowerCase() === "k" ? 1_000 : match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "b" ? 1_000_000_000 : 1;
    const number = Number(match[1]) * multiplier;
    if (!Number.isFinite(number) || number > 999_999_999_999) throw new Error(`Evidence for ${targetField} is out of range`);
    return String(Math.round(number * 100) / 100);
  }
  if (["expectedCloseDate", "dueDate"].includes(targetField)) {
    const date = parseDate(value);
    if (!date) throw new Error(`Evidence for ${targetField} must be a valid date`);
    return date;
  }
  if (targetField === "contactEmail" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error("Evidence for contactEmail must be a valid email address");
  }
  return targetField === "contactEmail" ? value.toLowerCase() : value;
};

const listEvidenceMappings = async (req: TenantRequest, intakeId: number, documentId: number) =>
  db.select().from(itbDocumentEvidenceMappingsTable).where(and(
    eq(itbDocumentEvidenceMappingsTable.intakeId, intakeId),
    eq(itbDocumentEvidenceMappingsTable.documentId, documentId),
    eq(itbDocumentEvidenceMappingsTable.tenantId, req.tenantId!),
    eq(itbDocumentEvidenceMappingsTable.environmentId, req.environmentId!),
  )).orderBy(desc(itbDocumentEvidenceMappingsTable.updatedAt));

const parseWithTimeout = async (name: string, contentType: string, bytes: Buffer) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOCUMENT_PARSE_TIMEOUT_MS);
  try {
    return await parseConstructionDocument(name, contentType, bytes, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const processDocument = async (req: TenantRequest, intakeId: number, attachmentId: number, role?: string, existingId?: number) => {
  const [attachmentRow] = await db.select({ attachment: itbIntakeAttachmentsTable, intake: itbIntakesTable })
    .from(itbIntakeAttachmentsTable)
    .innerJoin(itbIntakesTable, eq(itbIntakesTable.id, itbIntakeAttachmentsTable.intakeId))
    .where(and(
      eq(itbIntakeAttachmentsTable.id, attachmentId),
      eq(itbIntakeAttachmentsTable.intakeId, intakeId),
      eq(itbIntakesTable.tenantId, req.tenantId!),
      eq(itbIntakesTable.environmentId, req.environmentId!),
    )).limit(1);
  if (!attachmentRow) return null;
  const existing = existingId
    ? await getDocument(req, intakeId, existingId)
    : (await db.select({ document: itbDocumentsTable, attachment: itbIntakeAttachmentsTable })
      .from(itbDocumentsTable)
      .innerJoin(itbIntakeAttachmentsTable, eq(itbIntakeAttachmentsTable.id, itbDocumentsTable.attachmentId))
      .where(and(
        eq(itbDocumentsTable.attachmentId, attachmentId),
        eq(itbDocumentsTable.tenantId, req.tenantId!),
        eq(itbDocumentsTable.environmentId, req.environmentId!),
      )).limit(1))[0];
  if (existing && !["failed", "needs_review"].includes(existing.document.status)) {
    throw new Error("This attachment has already been processed");
  }
  const file = await objectStorage.getObjectFile(attachmentRow.attachment.objectPath);
  const [bytes] = await file.download();
  if (bytes.length > DOCUMENT_MAX_BYTES) {
    throw new Error("Document exceeds the protected parsing limit");
  }
  const hash = documentSha256(bytes);
  const roleValue = role ?? existing?.document.role ?? inferDocumentRole(attachmentRow.attachment.originalName);
  const now = new Date();
  let document: typeof itbDocumentsTable.$inferSelect;
  if (existing) {
    [document] = await db.update(itbDocumentsTable).set({
      role: roleValue,
      status: "processing",
      parser: null,
      parserVersion: DOCUMENT_PARSER_VERSION,
      sha256: hash,
      byteSize: bytes.length,
      errorMessage: null,
      attemptCount: existing.document.attemptCount + 1,
      updatedAt: now,
    }).where(eq(itbDocumentsTable.id, existing.document.id)).returning();
  } else {
    [document] = await db.insert(itbDocumentsTable).values({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      intakeId,
      attachmentId,
      role: roleValue,
      status: "processing",
      sha256: hash,
      byteSize: bytes.length,
      parserVersion: DOCUMENT_PARSER_VERSION,
      attemptCount: 1,
      createdByUserId: req.localUserId!,
    }).returning();
  }
  try {
    const parsed = await parseWithTimeout(attachmentRow.attachment.originalName, attachmentRow.attachment.contentType, bytes);
    [document] = await db.update(itbDocumentsTable).set({
      parser: parsed.parser,
      status: parsed.needsReview ? "needs_review" : "completed",
      extractedText: parsed.text,
      findingsJson: JSON.stringify(parsed.findings),
      pageCount: parsed.pageCount,
      errorMessage: parsed.warning ?? null,
      processedAt: now,
      updatedAt: new Date(),
    }).where(eq(itbDocumentsTable.id, document.id)).returning();
  } catch (error) {
    req.log.warn({ intakeId, attachmentId, documentId: document.id }, "ITB document parsing failed");
    [document] = await db.update(itbDocumentsTable).set({
      status: "failed",
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Document parsing failed",
      processedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(itbDocumentsTable.id, document.id)).returning();
  }
  return documentResponse(document, attachmentRow.attachment);
};

router.get("/itb-intakes/:intakeId/documents", async (req: TenantRequest, res) => {
  const params = GetItbIntakeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid intake id" });
    return;
  }
  const rows = await db.select({ document: itbDocumentsTable, attachment: itbIntakeAttachmentsTable })
    .from(itbDocumentsTable)
    .innerJoin(itbIntakeAttachmentsTable, eq(itbIntakeAttachmentsTable.id, itbDocumentsTable.attachmentId))
    .where(and(
      eq(itbDocumentsTable.intakeId, params.data.intakeId),
      eq(itbDocumentsTable.tenantId, req.tenantId!),
      eq(itbDocumentsTable.environmentId, req.environmentId!),
    ))
    .orderBy(desc(itbDocumentsTable.createdAt));
  res.json(rows.map((row) => documentResponse(row.document, row.attachment)));
});

router.post("/itb-intakes/:intakeId/documents", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = GetItbIntakeParams.safeParse(req.params);
  const parsed = ProcessItbDocumentBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid document processing request" });
    return;
  }
  try {
    const result = await processDocument(req, params.data.intakeId, parsed.data.attachmentId, parsed.data.role);
    if (!result) {
      res.status(404).json({ error: "Intake or attachment not found" });
      return;
    }
    res.status(201).json(result);
  } catch (error) {
    req.log.warn({ intakeId: params.data.intakeId, attachmentId: parsed.data.attachmentId }, "ITB document processing request rejected");
    res.status(409).json({ error: error instanceof Error ? error.message : "Document could not be processed" });
  }
});

router.post("/itb-intakes/:intakeId/documents/:documentId/retry", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = RetryItbDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  const current = await getDocument(req, params.data.intakeId, params.data.documentId);
  if (!current) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (!["failed", "needs_review"].includes(current.document.status) || current.document.attemptCount >= DOCUMENT_MAX_ATTEMPTS) {
    res.status(409).json({ error: "This document cannot be retried" });
    return;
  }
  try {
    const result = await processDocument(req, params.data.intakeId, current.document.attachmentId, current.document.role, current.document.id);
    res.json(result);
  } catch {
    req.log.warn({ intakeId: params.data.intakeId, documentId: params.data.documentId }, "ITB document retry failed");
    res.status(409).json({ error: "Document retry failed" });
  }
});

router.patch("/itb-intakes/:intakeId/documents/:documentId/findings", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = ReviewItbDocumentFindingsParams.safeParse(req.params);
  const parsed = ReviewItbDocumentFindingsBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid document finding review" });
    return;
  }
  const current = await getDocument(req, params.data.intakeId, params.data.documentId);
  if (!current) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const findings = documentJson<DocumentFinding[]>(current.document.findingsJson, []);
  const index = findings.findIndex((finding) => finding.key === parsed.data.key);
  if (index < 0) {
    res.status(404).json({ error: "Finding not found" });
    return;
  }
  findings[index] = {
    ...findings[index],
    status: parsed.data.status,
    correctedValue: parsed.data.correctedValue ?? findings[index].correctedValue ?? null,
  };
  const [updated] = await db.update(itbDocumentsTable).set({
    findingsJson: JSON.stringify(findings),
    updatedAt: new Date(),
  }).where(eq(itbDocumentsTable.id, current.document.id)).returning();
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId: req.tenantId!,
    action: "itb_document_finding_reviewed",
    details: JSON.stringify({ documentId: updated.id, intakeId: updated.intakeId, key: parsed.data.key, status: parsed.data.status, environmentId: req.environmentId }),
  });
  res.json(documentResponse(updated, current.attachment));
});

router.post("/itb-intakes/:intakeId/documents/:documentId/apply", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = ApplyItbDocumentFindingsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  const current = await getDocument(req, params.data.intakeId, params.data.documentId);
  if (!current) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const intake = await getIntake(req, params.data.intakeId);
  if (!intake) {
    res.status(404).json({ error: "Intake not found" });
    return;
  }
  if (intake.status === "approved") {
    res.status(409).json({ error: "Approved intakes cannot be changed" });
    return;
  }
  const findings = documentJson<DocumentFinding[]>(current.document.findingsJson, []);
  const accepted = findings.filter((finding) => ["accepted", "corrected"].includes(finding.status));
  if (accepted.length === 0) {
    res.status(409).json({ error: "Accept or correct at least one finding before applying it" });
    return;
  }
  const extraction = publicExtraction(intake);
  const mapping: Record<string, keyof Extraction> = {
    project_name: "projectName",
    issuer: "issuer",
    contact_name: "contactName",
    contact_email: "contactEmail",
    contact_phone: "contactPhone",
    location: "location",
    bid_due_date: "dueDate",
    estimated_value: "estimatedValue",
  };
  for (const finding of accepted) {
    const key = mapping[finding.key];
    if (!key) continue;
    const value = finding.status === "corrected" ? finding.correctedValue : finding.value;
    if (!value) continue;
    extraction[key] = {
      value,
      confidence: finding.confidence,
      evidence: `Document ${current.attachment.originalName}: ${finding.evidence}`.slice(0, 700),
    } as never;
  }
  const [updated] = await db.update(itbIntakesTable).set({
    extractionJson: JSON.stringify(extraction),
    extractionWarningsJson: JSON.stringify(extractionKeys.filter((key) => Array.isArray(extraction[key]) ? extraction[key].length === 0 : !extraction[key].value).map((key) => `No ${key} was supplied.`)),
    updatedAt: new Date(),
  }).where(and(
    eq(itbIntakesTable.id, intake.id),
    eq(itbIntakesTable.tenantId, req.tenantId!),
    eq(itbIntakesTable.environmentId, req.environmentId!),
  )).returning();
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId: req.tenantId!,
    action: "itb_document_findings_applied",
    details: JSON.stringify({ documentId: current.document.id, intakeId: intake.id, findingCount: accepted.length, environmentId: req.environmentId }),
  });
  res.json(serialize(updated, await getAttachments(updated.id)));
});

router.get("/itb-intakes/:intakeId/documents/:documentId/evidence-mappings", async (req: TenantRequest, res) => {
  const params = ListItbDocumentEvidenceMappingsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  const current = await getDocument(req, params.data.intakeId, params.data.documentId);
  if (!current) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(await listEvidenceMappings(req, params.data.intakeId, params.data.documentId));
});

router.post("/itb-intakes/:intakeId/documents/:documentId/evidence-mappings", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = MapItbDocumentEvidenceParams.safeParse(req.params);
  const parsed = MapItbDocumentEvidenceBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid evidence mapping request" });
    return;
  }
  const current = await getDocument(req, params.data.intakeId, params.data.documentId);
  if (!current) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const findings = documentJson<DocumentFinding[]>(current.document.findingsJson, []);
  const accepted = new Map(findings
    .filter((finding) => ["accepted", "corrected"].includes(finding.status))
    .map((finding) => [finding.key, finding]));
  if (accepted.size === 0) {
    res.status(409).json({ error: "Accept or correct at least one finding before mapping document evidence" });
    return;
  }
  const seenFields = new Set<string>();
  for (const mapping of parsed.data.mappings) {
    if (!accepted.has(mapping.findingKey)) {
      res.status(409).json({ error: `Finding ${mapping.findingKey} must be accepted or corrected before mapping` });
      return;
    }
    if (!evidenceTargetFields[parsed.data.targetType].has(mapping.targetField as never)) {
      res.status(400).json({ error: `${mapping.targetField} is not a supported ${parsed.data.targetType} field` });
      return;
    }
    if (seenFields.has(mapping.targetField)) {
      res.status(400).json({ error: "Each target field may be mapped only once per request" });
      return;
    }
    seenFields.add(mapping.targetField);
  }

  const intake = await getIntake(req, params.data.intakeId);
  if (!intake) {
    res.status(404).json({ error: "Intake not found" });
    return;
  }

  try {
    const saved = await db.transaction(async (tx) => {
      const now = new Date();
      let targetLabel = `${parsed.data.targetType} #${parsed.data.targetId}`;
      if (parsed.data.targetType === "opportunity") {
        const [target] = await tx.select().from(opportunitiesTable).where(and(
          eq(opportunitiesTable.id, parsed.data.targetId),
          eq(opportunitiesTable.tenantId, req.tenantId!),
          eq(opportunitiesTable.environmentId, req.environmentId!),
        ));
        if (!target) throw new Error("TARGET_NOT_FOUND");
        if (intake.opportunityId && intake.opportunityId !== target.id) throw new Error("TARGET_NOT_LINKED");
        targetLabel = target.name;
        for (const mapping of parsed.data.mappings) {
          const finding = accepted.get(mapping.findingKey)!;
          const value = normalizeMappedValue(mapping.targetField, finding.status === "corrected" ? finding.correctedValue ?? "" : finding.value);
          await tx.update(opportunitiesTable).set({ [mapping.targetField]: value, updatedAt: now } as never)
            .where(and(eq(opportunitiesTable.id, target.id), eq(opportunitiesTable.tenantId, req.tenantId!), eq(opportunitiesTable.environmentId, req.environmentId!)));
          await tx.insert(itbDocumentEvidenceMappingsTable).values({
            tenantId: req.tenantId!, environmentId: req.environmentId!, intakeId: intake.id, documentId: current.document.id,
            targetType: parsed.data.targetType, targetId: target.id, findingKey: finding.key, targetField: mapping.targetField,
            appliedValue: value, evidence: `Document ${current.attachment.originalName}: ${finding.evidence}`.slice(0, 700),
            createdByUserId: req.localUserId!, createdAt: now, updatedAt: now,
          }).onConflictDoUpdate({
            target: [
              itbDocumentEvidenceMappingsTable.tenantId,
              itbDocumentEvidenceMappingsTable.environmentId,
              itbDocumentEvidenceMappingsTable.documentId,
              itbDocumentEvidenceMappingsTable.targetType,
              itbDocumentEvidenceMappingsTable.targetId,
              itbDocumentEvidenceMappingsTable.targetField,
            ],
            set: { findingKey: finding.key, appliedValue: value, evidence: `Document ${current.attachment.originalName}: ${finding.evidence}`.slice(0, 700), createdByUserId: req.localUserId!, updatedAt: now },
          });
        }
      } else if (parsed.data.targetType === "bid") {
        const [target] = await tx.select().from(bidsTable).where(and(
          eq(bidsTable.id, parsed.data.targetId),
          eq(bidsTable.tenantId, req.tenantId!),
          eq(bidsTable.environmentId, req.environmentId!),
        ));
        if (!target) throw new Error("TARGET_NOT_FOUND");
        if (intake.bidId && intake.bidId !== target.id) throw new Error("TARGET_NOT_LINKED");
        if (intake.opportunityId && intake.opportunityId !== target.opportunityId) throw new Error("TARGET_NOT_LINKED");
        targetLabel = target.name;
        for (const mapping of parsed.data.mappings) {
          const finding = accepted.get(mapping.findingKey)!;
          const value = normalizeMappedValue(mapping.targetField, finding.status === "corrected" ? finding.correctedValue ?? "" : finding.value);
          await tx.update(bidsTable).set({ [mapping.targetField]: value, updatedAt: now } as never)
            .where(and(eq(bidsTable.id, target.id), eq(bidsTable.tenantId, req.tenantId!), eq(bidsTable.environmentId, req.environmentId!)));
          await tx.insert(itbDocumentEvidenceMappingsTable).values({
            tenantId: req.tenantId!, environmentId: req.environmentId!, intakeId: intake.id, documentId: current.document.id,
            targetType: parsed.data.targetType, targetId: target.id, findingKey: finding.key, targetField: mapping.targetField,
            appliedValue: value, evidence: `Document ${current.attachment.originalName}: ${finding.evidence}`.slice(0, 700),
            createdByUserId: req.localUserId!, createdAt: now, updatedAt: now,
          }).onConflictDoUpdate({
            target: [
              itbDocumentEvidenceMappingsTable.tenantId,
              itbDocumentEvidenceMappingsTable.environmentId,
              itbDocumentEvidenceMappingsTable.documentId,
              itbDocumentEvidenceMappingsTable.targetType,
              itbDocumentEvidenceMappingsTable.targetId,
              itbDocumentEvidenceMappingsTable.targetField,
            ],
            set: { findingKey: finding.key, appliedValue: value, evidence: `Document ${current.attachment.originalName}: ${finding.evidence}`.slice(0, 700), createdByUserId: req.localUserId!, updatedAt: now },
          });
        }
      } else {
        const [target] = await tx.select().from(projectsTable).where(and(
          eq(projectsTable.id, parsed.data.targetId),
          eq(projectsTable.tenantId, req.tenantId!),
          eq(projectsTable.environmentId, req.environmentId!),
        ));
        if (!target) throw new Error("TARGET_NOT_FOUND");
        targetLabel = target.projectName;
        for (const mapping of parsed.data.mappings) {
          const finding = accepted.get(mapping.findingKey)!;
          const value = normalizeMappedValue(mapping.targetField, finding.status === "corrected" ? finding.correctedValue ?? "" : finding.value);
          await tx.update(projectsTable).set({ [mapping.targetField]: value, updatedAt: now } as never)
            .where(and(eq(projectsTable.id, target.id), eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!)));
          await tx.insert(itbDocumentEvidenceMappingsTable).values({
            tenantId: req.tenantId!, environmentId: req.environmentId!, intakeId: intake.id, documentId: current.document.id,
            targetType: parsed.data.targetType, targetId: target.id, findingKey: finding.key, targetField: mapping.targetField,
            appliedValue: value, evidence: `Document ${current.attachment.originalName}: ${finding.evidence}`.slice(0, 700),
            createdByUserId: req.localUserId!, createdAt: now, updatedAt: now,
          }).onConflictDoUpdate({
            target: [
              itbDocumentEvidenceMappingsTable.tenantId,
              itbDocumentEvidenceMappingsTable.environmentId,
              itbDocumentEvidenceMappingsTable.documentId,
              itbDocumentEvidenceMappingsTable.targetType,
              itbDocumentEvidenceMappingsTable.targetId,
              itbDocumentEvidenceMappingsTable.targetField,
            ],
            set: { findingKey: finding.key, appliedValue: value, evidence: `Document ${current.attachment.originalName}: ${finding.evidence}`.slice(0, 700), createdByUserId: req.localUserId!, updatedAt: now },
          });
        }
      }
      await tx.insert(platformAuditEventsTable).values({
        actorUserId: req.localUserId!, tenantId: req.tenantId!, action: "itb_document_evidence_mapped",
        details: JSON.stringify({
          documentId: current.document.id, intakeId: intake.id, targetType: parsed.data.targetType,
          targetId: parsed.data.targetId, targetLabel, mappings: parsed.data.mappings, environmentId: req.environmentId,
        }),
      });
      return tx.select().from(itbDocumentEvidenceMappingsTable).where(and(
        eq(itbDocumentEvidenceMappingsTable.intakeId, intake.id),
        eq(itbDocumentEvidenceMappingsTable.documentId, current.document.id),
        eq(itbDocumentEvidenceMappingsTable.tenantId, req.tenantId!),
        eq(itbDocumentEvidenceMappingsTable.environmentId, req.environmentId!),
      )).orderBy(desc(itbDocumentEvidenceMappingsTable.updatedAt));
    });
    res.json(saved);
  } catch (error) {
    if (error instanceof Error && error.message === "TARGET_NOT_FOUND") {
      res.status(404).json({ error: "Target record not found in the active environment" });
      return;
    }
    if (error instanceof Error && error.message === "TARGET_NOT_LINKED") {
      res.status(409).json({ error: "Choose the opportunity or bid already linked to this intake" });
      return;
    }
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: "Document evidence could not be mapped" });
  }
});

router.get("/itb-intakes/:intakeId/attachments/:attachmentId", async (req: TenantRequest, res) => {
  const intakeId = Number(req.params.intakeId);
  const attachmentId = Number(req.params.attachmentId);
  if (!Number.isSafeInteger(intakeId) || !Number.isSafeInteger(attachmentId)) {
    res.status(400).json({ error: "Invalid attachment id" });
    return;
  }
  const [row] = await db.select({ attachment: itbIntakeAttachmentsTable }).from(itbIntakeAttachmentsTable).innerJoin(
    itbIntakesTable,
    and(eq(itbIntakesTable.id, itbIntakeAttachmentsTable.intakeId), eq(itbIntakesTable.tenantId, req.tenantId!), eq(itbIntakesTable.environmentId, req.environmentId!)),
  ).where(and(eq(itbIntakeAttachmentsTable.id, attachmentId), eq(itbIntakeAttachmentsTable.intakeId, intakeId))).limit(1);
  if (!row) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  try {
    const file = await objectStorage.getObjectFile(row.attachment.objectPath);
    res.setHeader("Content-Type", row.attachment.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${row.attachment.originalName.replace(/["\r\n]/g, "")}"`);
    file.createReadStream().on("error", (error) => req.log.error({ err: error, attachmentId }, "ITB attachment stream failed")).pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) res.status(404).json({ error: "Attachment object not found" });
    else {
      req.log.error({ err: error, attachmentId }, "ITB attachment download failed");
      res.status(503).json({ error: "Attachment is unavailable" });
    }
  }
});

export default router;