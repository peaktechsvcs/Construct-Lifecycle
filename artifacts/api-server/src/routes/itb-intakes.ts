import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  bidsTable,
  businessCustomersTable,
  db,
  itbIntakeAttachmentsTable,
  itbIntakesTable,
  itbMailboxCursorsTable,
  membershipsTable,
  opportunitiesTable,
  platformAuditEventsTable,
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
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { extractItb as extractItbFromSource } from "../lib/itb-extraction";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const connectors = new ReplitConnectors();
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
  const privateDir = process.env.PRIVATE_OBJECT_DIR?.replace(/^\/+|\/+$/g, "");
  return privateDir ? `/objects/${privateDir}/itb-intakes/` : "/objects/";
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

const decodeBase64Url = (value: string) => Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const collectMessageParts = (payload: any, result: { body: string; attachments: Array<{ id: string; name: string; contentType: string; size: number }> }) => {
  if (!payload) return;
  const mime = payload.mimeType ?? "";
  if (payload.filename && payload.body?.attachmentId) {
    result.attachments.push({ id: payload.body.attachmentId, name: payload.filename, contentType: mime || "application/octet-stream", size: Number(payload.body.size ?? 0) });
  }
  if (payload.body?.data && (mime === "text/plain" || mime === "text/html")) {
    const decoded = decodeBase64Url(payload.body.data).toString("utf8");
    if (!result.body || mime === "text/plain") result.body = decoded.replace(/<[^>]+>/g, " ");
  }
  for (const part of payload.parts ?? []) collectMessageParts(part, result);
};

const gmailRequest = async (path: string) => {
  const response = await connectors.proxy("google-mail", path, { method: "GET" });
  if (!response.ok) {
    const error = new Error(`Mailbox connector returned ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return response.json() as Promise<any>;
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
  try {
    const [cursor] = await db.select().from(itbMailboxCursorsTable).where(and(
      eq(itbMailboxCursorsTable.tenantId, req.tenantId!),
      eq(itbMailboxCursorsTable.environmentId, req.environmentId!),
      eq(itbMailboxCursorsTable.provider, "google-mail"),
      eq(itbMailboxCursorsTable.mailbox, "me"),
      eq(itbMailboxCursorsTable.query, q),
    )).limit(1);
    const pageToken = cursor?.nextPageToken ? `&pageToken=${encodeURIComponent(cursor.nextPageToken)}` : "";
    const result = await gmailRequest(`/gmail/v1/users/me/threads:search?q=${encodeURIComponent(q)}&pageSize=${pageSize}&view=THREAD_VIEW_MINIMAL${pageToken}`);
    await db.insert(itbMailboxCursorsTable).values({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      provider: "google-mail",
      mailbox: "me",
      query: q,
      nextPageToken: result.nextPageToken ?? null,
      lastSyncedAt: new Date(),
    }).onConflictDoUpdate({
      target: [
        itbMailboxCursorsTable.tenantId,
        itbMailboxCursorsTable.environmentId,
        itbMailboxCursorsTable.provider,
        itbMailboxCursorsTable.mailbox,
        itbMailboxCursorsTable.query,
      ],
      set: { nextPageToken: result.nextPageToken ?? null, lastSyncedAt: new Date(), updatedAt: new Date() },
    });
    const previews = (result.threads ?? []).flatMap((thread: any) => (thread.messages ?? []).slice(-1).map((message: any) => ({
      threadId: String(thread.id),
      messageId: String(message.id),
      subject: clean(message.subject, 300) ?? "(no subject)",
      sender: clean(message.sender, 180) ?? "(unknown sender)",
      receivedAt: message.date ?? new Date().toISOString(),
      snippet: clean(message.snippet, 500) ?? "",
      imported: false,
    })));
    const sourceIds: string[] = previews.map((preview: { messageId: string }) => preview.messageId);
    if (sourceIds.length) {
      const imported = await db.select({ sourceMessageId: itbIntakesTable.sourceMessageId }).from(itbIntakesTable).where(and(
        eq(itbIntakesTable.tenantId, req.tenantId!),
        eq(itbIntakesTable.environmentId, req.environmentId!),
        sql`${itbIntakesTable.sourceMessageId} in (${sql.join(sourceIds.map((id) => sql`${id}`), sql`, `)})`,
      ));
      const importedIds = new Set(imported.map((row) => row.sourceMessageId));
      for (const preview of previews) preview.imported = importedIds.has(preview.messageId);
    }
    res.json(previews);
  } catch (error) {
    const status = (error as { status?: number }).status;
    req.log.warn({ err: error, connectorStatus: status }, "ITB mailbox preview unavailable");
    res.status(424).json({ error: "The Gmail mailbox is not connected or could not be read" });
  }
});

router.post("/itb-intakes/mailbox/import", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const parsed = ImportItbMailboxMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid mailbox message" });
    return;
  }
  try {
    const thread = await gmailRequest(`/gmail/v1/users/me/threads/${encodeURIComponent(parsed.data.threadId)}?format=full`);
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    const message = parsed.data.messageId ? messages.find((candidate: any) => candidate.id === parsed.data.messageId) : messages[messages.length - 1];
    if (!message) {
      res.status(404).json({ error: "Mailbox message not found" });
      return;
    }
    const headers = message.payload?.headers as Array<{ name?: string; value?: string }> | undefined;
    const bodyResult = { body: message.snippet ?? "", attachments: [] as Array<{ id: string; name: string; contentType: string; size: number }> };
    collectMessageParts(message.payload, bodyResult);
    const sender = headerValue(headers, "From");
    const senderEmail = extractEmail(sender);
    const subject = headerValue(headers, "Subject") || message.subject || "";
    const receivedAt = message.date ?? (message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString());
    const intakeBody = {
      sourceType: "gmail" as const,
      sourceProvider: "google-mail",
      sourceMessageId: String(message.id),
      sourceThreadId: String(parsed.data.threadId),
      sourceSender: clean(sender, 180) ?? undefined,
      sourceSenderEmail: senderEmail ?? undefined,
      sourceSubject: clean(subject, 300) ?? undefined,
      sourceReceivedAt: receivedAt,
      sourceBody: bodyResult.body.slice(0, MAX_SOURCE_CHARS),
      attachments: [] as Array<{ originalName: string; contentType: string; size: number; objectPath: string; sourceAttachmentId: string }>,
    };
    for (const attachment of bodyResult.attachments.slice(0, 20)) {
      if (attachment.size > MAX_ATTACHMENT_BYTES) continue;
      try {
        const attachmentResponse = await connectors.proxy("google-mail", `/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`, { method: "GET" });
        if (!attachmentResponse.ok) continue;
        const attachmentBody = await attachmentResponse.json() as { data?: string; size?: number };
        if (!attachmentBody.data) continue;
        const bytes = decodeBase64Url(attachmentBody.data);
        if (bytes.length > MAX_ATTACHMENT_BYTES) continue;
        const stored = await objectStorage.storeBytes("itb-intakes", bytes, attachment.contentType);
        intakeBody.attachments.push({ originalName: attachment.name, contentType: attachment.contentType, size: bytes.length, objectPath: stored.objectPath, sourceAttachmentId: attachment.id });
      } catch (error) {
        req.log.warn({ err: error, attachmentName: attachment.name }, "ITB mailbox attachment could not be stored");
      }
    }
    const existing = await db.select().from(itbIntakesTable).where(and(
      eq(itbIntakesTable.tenantId, req.tenantId!),
      eq(itbIntakesTable.environmentId, req.environmentId!),
      eq(itbIntakesTable.sourceMessageId, intakeBody.sourceMessageId),
    )).limit(1);
    if (existing.length) {
      res.status(409).json({ error: "This mailbox message was already imported", intakeId: existing[0].id });
      return;
    }
    const { extraction, warnings } = extractItbFromSource(intakeBody.sourceSubject ?? null, intakeBody.sourceBody);
    const [created] = await db.insert(itbIntakesTable).values({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      sourceType: intakeBody.sourceType,
      sourceProvider: intakeBody.sourceProvider,
      sourceMessageId: intakeBody.sourceMessageId,
      sourceThreadId: intakeBody.sourceThreadId,
      sourceFingerprint: fingerprint(["google-mail", intakeBody.sourceMessageId]),
      sourceSender: intakeBody.sourceSender ?? null,
      sourceSenderEmail: intakeBody.sourceSenderEmail ?? null,
      sourceSubject: intakeBody.sourceSubject ?? null,
      sourceReceivedAt: new Date(intakeBody.sourceReceivedAt),
      sourceBody: intakeBody.sourceBody,
      extractionJson: JSON.stringify(extraction),
      extractionWarningsJson: JSON.stringify(warnings),
      createdByUserId: req.localUserId!,
    }).returning();
    if (intakeBody.attachments.length) {
      await db.insert(itbIntakeAttachmentsTable).values(intakeBody.attachments.map((attachment) => ({ ...attachment, intakeId: created.id })));
    }
    await db.insert(platformAuditEventsTable).values({
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      action: "itb_mailbox_message_imported",
      details: JSON.stringify({ intakeId: created.id, messageId: message.id, environmentId: req.environmentId }),
    });
    res.status(201).json(serialize(created, await getAttachments(created.id)));
  } catch (error) {
    const status = (error as { status?: number }).status;
    req.log.warn({ err: error, connectorStatus: status }, "ITB mailbox import unavailable");
    res.status(status === 404 ? 404 : 424).json({ error: "The Gmail message could not be imported" });
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