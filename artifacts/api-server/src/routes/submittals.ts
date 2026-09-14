import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import {
  bidsTable,
  bidProposalAttachmentsTable,
  businessCustomersTable,
  db,
  integrationAuditEventsTable,
  integrationEntitlementsTable,
  integrationsTable,
  platformAuditEventsTable,
  projectsTable,
  submittalPackageAssembliesTable,
  submittalCoordinationTable,
  submittalDocumentsTable,
  submittalItemsTable,
  submittalPackagesTable,
  submittalRevisionsTable,
  submittalTransmittalsTable,
  submittalSignatureEventsTable,
  submittalSignatureRequestsTable,
  submittalSignatureSignersTable,
} from "@workspace/db";
import {
  CreateSubmittalSignatureRequestBody,
  CreateSubmittalSignatureRequestParams,
  CreateSubmittalItemBody,
  CreateSubmittalItemParams,
  CreateSubmittalPackageBody,
  CreateSubmittalRevisionBody,
  CreateSubmittalRevisionParams,
  DeleteSubmittalItemParams,
  DeleteSubmittalPackageParams,
  GetSubmittalPackageParams,
  ListSubmittalSignatureRequestsParams,
  ListSubmittalPackagesQueryParams,
  MarkSubmittalAssemblySignatureReadyParams,
  UpdateSubmittalItemBody,
  UpdateSubmittalItemParams,
  UpdateSubmittalPackageBody,
  UpdateSubmittalPackageParams,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { screenStoredDocument } from "../lib/documentScreening";
import {
  getSignatureProvider,
  registerSignatureProvider,
} from "../lib/signatures/provider";
import { registerDocuSignSignatureProvider } from "../lib/signatures/docusign";
import {
  activeSignatureRequestStatuses,
  canTransitionSignatureRequestStatus,
  signatureRequestStatuses,
  type SignatureRequestStatus,
} from "../lib/signatures/state";
import { validateAndNormalizeSignatureSigners } from "../lib/signatures/validation";
import { getConnectorDefinition } from "../lib/integrations/catalog";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { createSubmittalDocumentProvider, DocumentProviderError, type DocumentProviderKey } from "../lib/submittal-document-provider";

const router: IRouter = Router();

const packageStatuses = ["draft", "submitted", "under_review", "approved", "approved_as_noted", "revise_and_resubmit", "rejected", "superseded"] as const;
const originTypes = ["contract", "accepted_substitution", "accepted_alternate", "early_procurement"] as const;
const itemTypes = ["shop_drawing", "product_data", "sample", "mockup", "calculation", "certificate", "warranty", "closeout", "other"] as const;
const itemStatuses = ["pending", "included", "needs_revision", "accepted", "superseded"] as const;
const coordinationTypes = ["procurement", "fabrication", "installation", "schedule"] as const;
const coordinationStatuses = ["pending", "in_progress", "blocked", "completed", "failed"] as const;
const transmittalPurposes = ["review", "resubmission", "record", "closeout"] as const;
const assemblyInput = z.object({
  items: z.array(z.object({
    itemId: z.number().int().positive(),
    documentId: z.number().int().positive(),
    pageOrder: z.array(z.number().int().positive()).optional(),
  })).min(1).max(200),
});
const itemOrderInput = z.object({
  itemIds: z.array(z.number().int().positive()).min(1).max(200),
});
const pageOrderInput = z.object({
  pageOrder: z.array(z.number().int().positive()).min(1).max(500),
});
const objectStorage = new ObjectStorageService();
const connectors = new ReplitConnectors();
const documentProvider = createSubmittalDocumentProvider(connectors);
registerDocuSignSignatureProvider(connectors, registerSignatureProvider);
const maxDocumentSize = 100 * 1024 * 1024;
const uploadRateWindowMs = 60_000;
const uploadRateLimit = 20;
const uploadAttempts = new Map<string, { count: number; resetAt: number }>();
const signatureSendRateWindowMs = 60_000;
const signatureSendRateLimit = 10;
const signatureSendAttempts = new Map<string, { count: number; resetAt: number }>();
const documentRequestBody = z.object({
  originalName: z.string().trim().min(1).max(255),
  size: z.number().int().min(1).max(maxDocumentSize),
  contentType: z.string().trim().min(1).max(160),
});
const coordinationInput = z.object({
  revisionId: z.number().int().positive().optional(),
  coordinationType: z.enum(coordinationTypes),
  status: z.enum(coordinationStatuses).optional(),
  ownerName: z.string().trim().max(180).optional(),
  externalReference: z.string().trim().max(180).optional(),
  notes: z.string().trim().max(5000).optional(),
  dueDate: z.string().date().optional(),
  failureReason: z.string().trim().max(2000).optional(),
});
const coordinationUpdate = coordinationInput.partial().extend({
  revisionId: z.number().int().positive().nullable().optional(),
  ownerName: z.string().trim().max(180).nullable().optional(),
  externalReference: z.string().trim().max(180).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  failureReason: z.string().trim().max(2000).nullable().optional(),
});
const seedFromBidInput = z.object({
  bidId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  attachmentIds: z.array(z.number().int().positive()).max(200).optional(),
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(5000).optional(),
  specificationSection: z.string().trim().max(120).optional(),
  responsibleParty: z.string().trim().max(180).optional(),
  dueDate: z.string().date().optional(),
  originType: z.enum(originTypes).optional(),
});
const transmittalInput = z.object({
  revisionId: z.number().int().positive().optional(),
  purpose: z.enum(transmittalPurposes).optional(),
  transmittalNumber: z.string().trim().max(120).optional(),
  dueDate: z.string().date().optional(),
  fromParty: z.string().trim().max(180).optional(),
  toParty: z.string().trim().max(180).optional(),
  notes: z.string().trim().max(5000).optional(),
});
const signatureRequestParams = z.object({
  requestId: z.coerce.number().int().positive(),
});
const sendSignatureRequestInput = z.object({
  providerKey: z.string().trim().min(1).max(80),
});
const sanitizeFileName = (value: string) =>
  value.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).pop()?.trim().slice(0, 255) || "submittal-document";
const isAllowedDocumentType = (contentType: string) =>
  contentType === "application/pdf"
  || contentType === "application/octet-stream"
  || ["image/gif", "image/jpeg", "image/png", "image/webp", "image/tiff"].includes(contentType)
  || ["text/plain", "text/csv"].includes(contentType)
  || contentType === "application/zip"
  || [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ].includes(contentType);

const takeUploadAttempt = (req: TenantRequest) => {
  const key = `${req.tenantId}:${req.environmentId}:${req.localUserId}`;
  const now = Date.now();
  const current = uploadAttempts.get(key);
  if (!current || current.resetAt <= now) {
    uploadAttempts.set(key, { count: 1, resetAt: now + uploadRateWindowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  if (current.count > uploadRateLimit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
};

const rejectUploadRate = (req: TenantRequest, res: Response) => {
  const attempt = takeUploadAttempt(req);
  if (attempt.allowed) return false;
  res.setHeader("Retry-After", String(attempt.retryAfterSeconds));
  res.status(429).json({ error: "Too many document upload attempts. Try again shortly." });
  return true;
};

const dateString = (value: Date | string | null | undefined) => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
};

const submittedTimestamp = (status: string, current: Date | null) =>
  ["submitted", "under_review", "approved", "approved_as_noted", "revise_and_resubmit", "rejected", "superseded"].includes(status)
    ? current ?? new Date()
    : current;

const reviewedTimestamp = (status: string, current: Date | null) =>
  ["approved", "approved_as_noted", "revise_and_resubmit", "rejected", "superseded"].includes(status)
    ? current ?? new Date()
    : current;

const getPackageBase = async (req: TenantRequest, submittalId: number) => {
  const [row] = await db
    .select({
      package: submittalPackagesTable,
      projectNumber: projectsTable.projectNumber,
      projectName: projectsTable.projectName,
      customerName: projectsTable.customerName,
      sourceBidNumber: bidsTable.bidNumber,
    })
    .from(submittalPackagesTable)
    .innerJoin(projectsTable, and(
      eq(submittalPackagesTable.projectId, projectsTable.id),
      eq(projectsTable.tenantId, req.tenantId!),
      eq(projectsTable.environmentId, req.environmentId!),
    ))
    .leftJoin(bidsTable, and(
      eq(submittalPackagesTable.sourceBidId, bidsTable.id),
      eq(bidsTable.tenantId, req.tenantId!),
      eq(bidsTable.environmentId, req.environmentId!),
    ))
    .where(and(
      eq(submittalPackagesTable.id, submittalId),
      eq(submittalPackagesTable.tenantId, req.tenantId!),
      eq(submittalPackagesTable.environmentId, req.environmentId!),
    ))
    .limit(1);
  return row;
};

const serializeDocument = (document: typeof submittalDocumentsTable.$inferSelect) => ({
  id: document.id,
  itemId: document.itemId,
  originalName: document.originalName,
  contentType: document.contentType,
  size: document.size,
  pageCount: document.pageCount,
  pageOrder: document.pageOrder ? JSON.parse(document.pageOrder) : null,
  version: document.version,
  status: document.status,
  providerKey: document.providerKey,
  externalId: document.externalId,
  sourceUrl: document.sourceUrl,
  importStatus: document.importStatus,
  failureReason: document.failureReason,
  uploadedAt: document.uploadedAt,
  createdAt: document.createdAt,
  downloadUrl: `/api/submittal-documents/${document.id}`,
});

const documentProviderInput = z.object({
  providerKey: z.literal("google_workspace"),
  externalId: z.string().trim().min(1).max(200),
});

const documentProviderQuery = z.object({
  providerKey: z.literal("google_workspace").default("google_workspace"),
  search: z.string().trim().max(120).default(""),
  pageToken: z.string().trim().max(2000).optional(),
});

const connectedDocumentProvider = async (req: TenantRequest, providerKey: DocumentProviderKey) => {
  const [integration] = await db.select().from(integrationsTable).where(and(
    eq(integrationsTable.tenantId, req.tenantId!),
    eq(integrationsTable.environmentId, req.environmentId!),
    eq(integrationsTable.providerKey, providerKey),
    eq(integrationsTable.status, "connected"),
  )).limit(1);
  const [entitlement] = await db.select({ id: integrationEntitlementsTable.id }).from(integrationEntitlementsTable).where(and(
    eq(integrationEntitlementsTable.tenantId, req.tenantId!),
    eq(integrationEntitlementsTable.capabilityKey, providerKey),
    eq(integrationEntitlementsTable.enabled, true),
  )).limit(1);
  if (!integration || !entitlement || !integration.credentialsReference) return null;
  const connectionId = integration.credentialsReference.split(":").at(-1);
  const available = await connectors.listConnections({ connector_names: "google-mail", refresh_policy: "force" });
  const selected = available.find((connection) => connection.id === connectionId && connection.status === "connected");
  return selected ? integration : null;
};

const serializeItem = (
  item: typeof submittalItemsTable.$inferSelect,
  documents: typeof submittalDocumentsTable.$inferSelect[] = [],
) => ({
  id: item.id,
  packageId: item.packageId,
  itemNumber: item.itemNumber,
  sortOrder: item.sortOrder,
  itemType: item.itemType,
  name: item.name,
  description: item.description,
  status: item.status,
  documentName: item.documentName,
  documentUrl: item.documentUrl,
  sourceBidAttachmentId: item.sourceBidAttachmentId,
  reviewerName: item.reviewerName,
  reviewComments: item.reviewComments,
  documents: documents.map(serializeDocument),
  revision: item.revision,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const serializeAssembly = (assembly: typeof submittalPackageAssembliesTable.$inferSelect) => ({
  id: assembly.id,
  packageId: assembly.packageId,
  version: assembly.version,
  status: assembly.status,
  signatureReady: assembly.signatureReady,
  signatureReadyAt: assembly.signatureReadyAt,
  originalFileName: assembly.originalFileName,
  contentType: assembly.contentType,
  size: assembly.size,
  itemOrder: JSON.parse(assembly.itemOrder),
  pagePlan: JSON.parse(assembly.pagePlan),
  createdAt: assembly.createdAt,
  downloadUrl: `/api/submittal-assemblies/${assembly.id}`,
});

const parseObject = (value: string | null | undefined): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const requiredSignatureCapabilities = ["send", "status", "cancel", "download_signed_document"] as const;

const getConnectedSignatureProviders = async (req: TenantRequest) => {
  const rows = await db.select({
    integrationId: integrationsTable.id,
    providerKey: integrationsTable.providerKey,
  })
    .from(integrationsTable)
    .innerJoin(integrationEntitlementsTable, and(
      eq(integrationEntitlementsTable.tenantId, integrationsTable.tenantId),
      eq(integrationEntitlementsTable.capabilityKey, integrationsTable.providerKey),
      eq(integrationEntitlementsTable.enabled, true),
    ))
    .where(and(
      eq(integrationsTable.tenantId, req.tenantId!),
      eq(integrationsTable.environmentId, req.environmentId!),
      eq(integrationsTable.providerCategory, "e_signature"),
      eq(integrationsTable.status, "connected"),
    ));
  return rows.map((row) => {
    const provider = getSignatureProvider(row.providerKey);
    const definition = getConnectorDefinition(row.providerKey);
    if (!provider || !requiredSignatureCapabilities.every((capability) => provider.capabilities.has(capability))) {
      return null;
    }
    return {
      integrationId: row.integrationId,
      providerKey: row.providerKey,
      name: definition?.name ?? row.providerKey,
      capabilities: [...provider.capabilities],
    };
  }).filter((provider): provider is NonNullable<typeof provider> => Boolean(provider));
};

const serializeSignatureEvent = (event: typeof submittalSignatureEventsTable.$inferSelect) => ({
  id: event.id,
  eventType: event.eventType,
  fromStatus: event.fromStatus,
  toStatus: event.toStatus,
  details: parseObject(event.details),
  createdAt: event.createdAt,
});

const loadSignatureRequests = async (req: TenantRequest, packageId: number) => {
  const connectedProviders = await getConnectedSignatureProviders(req);
  const connectedProviderKeys = connectedProviders.map((provider) => provider.providerKey);
  const requests = await db.select().from(submittalSignatureRequestsTable)
    .where(and(
      eq(submittalSignatureRequestsTable.packageId, packageId),
      eq(submittalSignatureRequestsTable.tenantId, req.tenantId!),
      eq(submittalSignatureRequestsTable.environmentId, req.environmentId!),
    ))
    .orderBy(desc(submittalSignatureRequestsTable.createdAt));
  if (requests.length === 0) return [];

  const requestIds = requests.map((request) => request.id);
  const [signers, events] = await Promise.all([
    db.select().from(submittalSignatureSignersTable)
      .where(and(
        inArray(submittalSignatureSignersTable.requestId, requestIds),
        eq(submittalSignatureSignersTable.tenantId, req.tenantId!),
        eq(submittalSignatureSignersTable.environmentId, req.environmentId!),
      ))
      .orderBy(submittalSignatureSignersTable.signingOrder, submittalSignatureSignersTable.id),
    db.select().from(submittalSignatureEventsTable)
      .where(and(
        inArray(submittalSignatureEventsTable.requestId, requestIds),
        eq(submittalSignatureEventsTable.tenantId, req.tenantId!),
        eq(submittalSignatureEventsTable.environmentId, req.environmentId!),
      ))
      .orderBy(submittalSignatureEventsTable.createdAt, submittalSignatureEventsTable.id),
  ]);
  const signersByRequest = new Map<number, typeof signers>();
  const eventsByRequest = new Map<number, typeof events>();
  for (const signer of signers) {
    const current = signersByRequest.get(signer.requestId) ?? [];
    current.push(signer);
    signersByRequest.set(signer.requestId, current);
  }
  for (const event of events) {
    const current = eventsByRequest.get(event.requestId) ?? [];
    current.push(event);
    eventsByRequest.set(event.requestId, current);
  }
  return requests.map((request) => {
    const externalMetadata = parseObject(request.externalMetadata);
    const signedDocument = externalMetadata.signedDocument;
    return {
    id: request.id,
    packageId: request.packageId,
    assemblyId: request.assemblyId,
    title: request.title,
    status: request.status,
    providerKey: request.providerKey,
    providerRequestId: request.providerRequestId,
    externalMetadata,
    providerAvailable: Boolean(request.providerKey && connectedProviderKeys.includes(request.providerKey) && getSignatureProvider(request.providerKey)),
    signedDocumentAvailable: Boolean(
      signedDocument
      && typeof signedDocument === "object"
      && !Array.isArray(signedDocument)
      && typeof (signedDocument as { objectPath?: unknown }).objectPath === "string",
    ),
    signers: (signersByRequest.get(request.id) ?? []).map((signer) => ({
      id: signer.id,
      name: signer.name,
      email: signer.email,
      role: signer.role,
      signingOrder: signer.signingOrder,
      status: signer.status,
      createdAt: signer.createdAt,
      updatedAt: signer.updatedAt,
    })),
    events: (eventsByRequest.get(request.id) ?? []).map(serializeSignatureEvent),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    };
  });
};

const serializeRevision = (revision: typeof submittalRevisionsTable.$inferSelect) => ({
  id: revision.id,
  packageId: revision.packageId,
  revision: revision.revision,
  status: revision.status,
  reviewerName: revision.reviewerName,
  reviewComments: revision.reviewComments,
  submittedAt: revision.submittedAt,
  reviewedAt: revision.reviewedAt,
  createdAt: revision.createdAt,
});

const serializeCoordination = (record: typeof submittalCoordinationTable.$inferSelect) => ({
  id: record.id,
  packageId: record.packageId,
  revisionId: record.revisionId,
  coordinationType: record.coordinationType,
  status: record.status,
  ownerName: record.ownerName,
  externalReference: record.externalReference,
  notes: record.notes,
  dueDate: record.dueDate,
  failureReason: record.failureReason,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const serializeTransmittal = (record: typeof submittalTransmittalsTable.$inferSelect) => ({
  id: record.id,
  packageId: record.packageId,
  revisionId: record.revisionId,
  transmittalNumber: record.transmittalNumber,
  purpose: record.purpose,
  sentAt: record.sentAt,
  dueDate: record.dueDate,
  fromParty: record.fromParty,
  toParty: record.toParty,
  notes: record.notes,
  createdAt: record.createdAt,
});

const serializePackage = async (req: TenantRequest, row: Awaited<ReturnType<typeof getPackageBase>>) => {
  if (!row) return null;
  const [items, revisions, transmittals, signatureRequests, signatureProviders] = await Promise.all([
    db.select().from(submittalItemsTable)
      .where(and(
        eq(submittalItemsTable.packageId, row.package.id),
        eq(submittalItemsTable.tenantId, row.package.tenantId),
        eq(submittalItemsTable.environmentId, row.package.environmentId),
      ))
      .orderBy(submittalItemsTable.sortOrder, submittalItemsTable.itemNumber),
    db.select().from(submittalRevisionsTable)
      .where(and(
        eq(submittalRevisionsTable.packageId, row.package.id),
        eq(submittalRevisionsTable.tenantId, row.package.tenantId),
        eq(submittalRevisionsTable.environmentId, row.package.environmentId),
      ))
      .orderBy(desc(submittalRevisionsTable.revision)),
    db.select().from(submittalTransmittalsTable)
      .where(and(
        eq(submittalTransmittalsTable.packageId, row.package.id),
        eq(submittalTransmittalsTable.tenantId, row.package.tenantId),
        eq(submittalTransmittalsTable.environmentId, row.package.environmentId),
      ))
      .orderBy(desc(submittalTransmittalsTable.sentAt), desc(submittalTransmittalsTable.id)),
    loadSignatureRequests(req, row.package.id),
    getConnectedSignatureProviders(req),
  ]);
  const assemblies = await db.select().from(submittalPackageAssembliesTable)
    .where(and(
      eq(submittalPackageAssembliesTable.packageId, row.package.id),
      eq(submittalPackageAssembliesTable.tenantId, row.package.tenantId),
      eq(submittalPackageAssembliesTable.environmentId, row.package.environmentId),
    ))
    .orderBy(desc(submittalPackageAssembliesTable.createdAt));
  const documents = items.length
    ? await db.select().from(submittalDocumentsTable)
      .where(and(
        inArray(submittalDocumentsTable.itemId, items.map((item) => item.id)),
        eq(submittalDocumentsTable.tenantId, row.package.tenantId),
        eq(submittalDocumentsTable.environmentId, row.package.environmentId),
      ))
      .orderBy(desc(submittalDocumentsTable.createdAt))
    : [];
  const documentsByItem = new Map<number, typeof documents>();
  for (const document of documents) {
    const existing = documentsByItem.get(document.itemId) ?? [];
    existing.push(document);
    documentsByItem.set(document.itemId, existing);
  }
  return {
    id: row.package.id,
    environmentId: row.package.environmentId,
    packageNumber: row.package.packageNumber,
    projectId: row.package.projectId,
    projectNumber: row.projectNumber,
    projectName: row.projectName,
    customerName: row.customerName,
    sourceBidId: row.package.sourceBidId,
    sourceBidNumber: row.sourceBidNumber,
    originType: row.package.originType,
    name: row.package.name,
    description: row.package.description,
    specificationSection: row.package.specificationSection,
    responsibleParty: row.package.responsibleParty,
    status: row.package.status,
    dueDate: row.package.dueDate,
    revision: row.package.revision,
    reviewerName: row.package.reviewerName,
    reviewComments: row.package.reviewComments,
    submittedAt: row.package.submittedAt,
    reviewedAt: row.package.reviewedAt,
    itemCount: items.length,
    items: items.map((item) => serializeItem(item, documentsByItem.get(item.id))),
    revisions: revisions.map(serializeRevision),
    transmittals: transmittals.map(serializeTransmittal),
    assemblies: assemblies.map(serializeAssembly),
     signatureProviderAvailable: signatureProviders.length > 0,
     signatureProviders: signatureProviders.map((provider) => ({
       providerKey: provider.providerKey,
       name: provider.name,
       capabilities: provider.capabilities,
     })),
    signatureRequests,
    createdAt: row.package.createdAt,
    updatedAt: row.package.updatedAt,
  };
};

const getPackageForMutation = async (req: TenantRequest, submittalId: number) => {
  const row = await getPackageBase(req, submittalId);
  return row?.package;
};

const getRevisionInPackage = async (req: TenantRequest, packageId: number, revisionId: number) => {
  const [revision] = await db.select({ id: submittalRevisionsTable.id }).from(submittalRevisionsTable).where(and(
    eq(submittalRevisionsTable.id, revisionId),
    eq(submittalRevisionsTable.packageId, packageId),
    eq(submittalRevisionsTable.tenantId, req.tenantId!),
    eq(submittalRevisionsTable.environmentId, req.environmentId!),
  ));
  return revision;
};

router.post("/submittals/from-bid", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = seedFromBidInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid awarded bid submittal register details", details: parsed.error.issues });
    return;
  }
  const [bid] = await db.select().from(bidsTable).where(and(
    eq(bidsTable.id, parsed.data.bidId),
    eq(bidsTable.tenantId, req.tenantId!),
    eq(bidsTable.environmentId, req.environmentId!),
  ));
  if (!bid) {
    res.status(404).json({ error: "Bid not found in the active environment" });
    return;
  }
  if (bid.stage !== "awarded") {
    res.status(409).json({ error: "Only awarded bids can seed a project submittal register" });
    return;
  }
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(and(
    eq(projectsTable.id, parsed.data.projectId),
    eq(projectsTable.tenantId, req.tenantId!),
    eq(projectsTable.environmentId, req.environmentId!),
  ));
  if (!project) {
    res.status(400).json({ error: "Project not found in the active environment" });
    return;
  }
  const attachments = await db.select().from(bidProposalAttachmentsTable).where(and(
    eq(bidProposalAttachmentsTable.bidId, bid.id),
    eq(bidProposalAttachmentsTable.tenantId, req.tenantId!),
    eq(bidProposalAttachmentsTable.environmentId, req.environmentId!),
    parsed.data.attachmentIds?.length ? inArray(bidProposalAttachmentsTable.id, parsed.data.attachmentIds) : undefined,
  ));
  if (parsed.data.attachmentIds?.length && attachments.length !== parsed.data.attachmentIds.length) {
    res.status(400).json({ error: "Every selected bid-stage attachment must belong to the active bid and environment" });
    return;
  }
  const commitments = attachments.filter((attachment) =>
    ["alternate", "substitution_request", "requested_product_data"].includes(attachment.purpose)
    && attachment.conversionStatus === "accepted",
  );
  if (commitments.length === 0) {
    res.status(400).json({ error: "Select at least one accepted alternate, substitution request, or requested product data attachment" });
    return;
  }
  const originType = parsed.data.originType
    ?? (commitments.some((attachment) => attachment.purpose === "substitution_request") ? "accepted_substitution"
      : commitments.some((attachment) => attachment.purpose === "alternate") ? "accepted_alternate" : "contract");
  const created = await db.transaction(async (tx) => {
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(submittalPackagesTable)
      .where(and(eq(submittalPackagesTable.tenantId, req.tenantId!), eq(submittalPackagesTable.environmentId, req.environmentId!)));
    const packageNumber = `SUB-${new Date().getFullYear()}-${String(Number(count) + 1).padStart(3, "0")}`;
    const [pkg] = await tx.insert(submittalPackagesTable).values({
      packageNumber,
      projectId: parsed.data.projectId,
      sourceBidId: bid.id,
      originType,
      name: parsed.data.name,
      description: parsed.data.description || null,
      specificationSection: parsed.data.specificationSection || null,
      responsibleParty: parsed.data.responsibleParty || null,
      dueDate: parsed.data.dueDate || null,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    }).returning();
    await tx.insert(submittalItemsTable).values(commitments.map((attachment, index) => ({
      packageId: pkg.id,
      itemNumber: `${packageNumber}.${index + 1}`,
      sortOrder: index,
      itemType: attachment.purpose === "requested_product_data" ? "product_data" : "other",
      name: attachment.title,
      description: attachment.description,
      status: "pending",
      documentName: attachment.documentName,
      documentUrl: attachment.documentUrl,
      sourceBidAttachmentId: attachment.id,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    })));
    await tx.update(bidProposalAttachmentsTable).set({
      conversionStatus: "converted",
      updatedAt: new Date(),
    }).where(and(
      inArray(bidProposalAttachmentsTable.id, commitments.map((attachment) => attachment.id)),
      eq(bidProposalAttachmentsTable.tenantId, req.tenantId!),
      eq(bidProposalAttachmentsTable.environmentId, req.environmentId!),
    ));
    return pkg;
  });
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId: req.tenantId!,
    action: "submittal_register_seeded_from_awarded_bid",
    details: JSON.stringify({ submittalId: created.id, bidId: bid.id, projectId: project.id, environmentId: req.environmentId }),
  });
  res.status(201).json(await serializePackage(req, await getPackageBase(req, created.id)));
});

router.get("/submittals", async (req: TenantRequest, res) => {
  const parsed = ListSubmittalPackagesQueryParams.safeParse({
    search: req.query.search,
    status: req.query.status,
    projectId: req.query.projectId,
  });
  const filters = parsed.success ? parsed.data : {};
  const conditions = [
    eq(submittalPackagesTable.tenantId, req.tenantId!),
    eq(submittalPackagesTable.environmentId, req.environmentId!),
  ];
  if (filters.status) conditions.push(eq(submittalPackagesTable.status, filters.status));
  if (filters.projectId) conditions.push(eq(submittalPackagesTable.projectId, filters.projectId));
  const search = filters.search?.trim();
  const rows = await db
    .select({
      id: submittalPackagesTable.id,
      projectId: submittalPackagesTable.projectId,
      packageNumber: submittalPackagesTable.packageNumber,
      name: submittalPackagesTable.name,
      description: submittalPackagesTable.description,
      specificationSection: submittalPackagesTable.specificationSection,
      responsibleParty: submittalPackagesTable.responsibleParty,
      status: submittalPackagesTable.status,
      dueDate: submittalPackagesTable.dueDate,
      revision: submittalPackagesTable.revision,
      reviewerName: submittalPackagesTable.reviewerName,
      reviewComments: submittalPackagesTable.reviewComments,
      submittedAt: submittalPackagesTable.submittedAt,
      reviewedAt: submittalPackagesTable.reviewedAt,
      sourceBidId: submittalPackagesTable.sourceBidId,
      originType: submittalPackagesTable.originType,
      itemCount: sql<number>`count(${submittalItemsTable.id})::int`,
      projectNumber: projectsTable.projectNumber,
      projectName: projectsTable.projectName,
      customerName: projectsTable.customerName,
      sourceBidNumber: bidsTable.bidNumber,
      createdAt: submittalPackagesTable.createdAt,
      updatedAt: submittalPackagesTable.updatedAt,
    })
    .from(submittalPackagesTable)
    .innerJoin(projectsTable, and(
      eq(submittalPackagesTable.projectId, projectsTable.id),
      eq(projectsTable.tenantId, req.tenantId!),
      eq(projectsTable.environmentId, req.environmentId!),
    ))
    .leftJoin(bidsTable, and(
      eq(submittalPackagesTable.sourceBidId, bidsTable.id),
      eq(bidsTable.tenantId, req.tenantId!),
      eq(bidsTable.environmentId, req.environmentId!),
    ))
    .leftJoin(submittalItemsTable, and(
      eq(submittalItemsTable.packageId, submittalPackagesTable.id),
      eq(submittalItemsTable.tenantId, req.tenantId!),
      eq(submittalItemsTable.environmentId, req.environmentId!),
    ))
    .where(and(
      ...conditions,
      search
        ? or(
            ilike(submittalPackagesTable.packageNumber, `%${search}%`),
            ilike(submittalPackagesTable.name, `%${search}%`),
            ilike(projectsTable.projectNumber, `%${search}%`),
            ilike(projectsTable.projectName, `%${search}%`),
            ilike(projectsTable.customerName, `%${search}%`),
          )
        : undefined,
    ))
    .groupBy(
      submittalPackagesTable.id,
      projectsTable.projectNumber,
      projectsTable.projectName,
      projectsTable.customerName,
    )
    .orderBy(desc(submittalPackagesTable.updatedAt))
    .limit(200);
  res.json(rows.map((row) => ({
    ...row,
    environmentId: req.environmentId!,
    items: [],
    revisions: [],
  })));
});

router.post("/submittals", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateSubmittalPackageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid submittal package details", details: parsed.error.issues });
    return;
  }
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(and(
    eq(projectsTable.id, parsed.data.projectId),
    eq(projectsTable.tenantId, req.tenantId!),
    eq(projectsTable.environmentId, req.environmentId!),
  ));
  if (!project) {
    res.status(400).json({ error: "Project not found in the active environment" });
    return;
  }
  if (parsed.data.sourceBidId) {
    const [bid] = await db.select({ id: bidsTable.id }).from(bidsTable).where(and(
      eq(bidsTable.id, parsed.data.sourceBidId),
      eq(bidsTable.tenantId, req.tenantId!),
      eq(bidsTable.environmentId, req.environmentId!),
    ));
    if (!bid) {
      res.status(400).json({ error: "Source bid not found in the active environment" });
      return;
    }
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(submittalPackagesTable)
    .where(and(eq(submittalPackagesTable.tenantId, req.tenantId!), eq(submittalPackagesTable.environmentId, req.environmentId!)));
  const packageNumber = `SUB-${new Date().getFullYear()}-${String(Number(count) + 1).padStart(3, "0")}`;
  const status = parsed.data.status ?? "draft";
  const now = new Date();
  const [created] = await db.insert(submittalPackagesTable).values({
    packageNumber,
    projectId: parsed.data.projectId,
    sourceBidId: parsed.data.sourceBidId ?? null,
    originType: parsed.data.originType ?? "contract",
    name: parsed.data.name.trim(),
    description: parsed.data.description?.trim() || null,
    specificationSection: parsed.data.specificationSection?.trim() || null,
    responsibleParty: parsed.data.responsibleParty?.trim() || null,
    status,
    dueDate: dateString(parsed.data.dueDate),
    submittedAt: submittedTimestamp(status, null),
    reviewedAt: reviewedTimestamp(status, null),
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId: req.tenantId!,
    action: "submittal_package_created",
    details: JSON.stringify({ submittalId: created.id, environmentId: req.environmentId }),
  });
  res.status(201).json(await serializePackage(req, await getPackageBase(req, created.id)));
});

router.get("/submittals/:submittalId", async (req: TenantRequest, res) => {
  const parsed = GetSubmittalPackageParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid submittal package id" });
    return;
  }
  const row = await getPackageBase(req, parsed.data.submittalId);
  if (!row) {
    res.status(404).json({ error: "Submittal package not found" });
    return;
  }
  res.json(await serializePackage(req, row));
});

router.patch("/submittals/:submittalId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateSubmittalPackageParams.safeParse(req.params);
  const parsed = UpdateSubmittalPackageBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid submittal package update" });
    return;
  }
  const existing = await getPackageForMutation(req, params.data.submittalId);
  if (!existing) {
    res.status(404).json({ error: "Submittal package not found" });
    return;
  }
  const status = parsed.data.status ?? existing.status;
  await db.update(submittalPackagesTable).set({
    ...(parsed.data.sourceBidId !== undefined ? { sourceBidId: parsed.data.sourceBidId } : {}),
    ...(parsed.data.originType !== undefined ? { originType: parsed.data.originType } : {}),
    ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.description !== undefined ? { description: parsed.data.description?.trim() || null } : {}),
    ...(parsed.data.specificationSection !== undefined ? { specificationSection: parsed.data.specificationSection?.trim() || null } : {}),
    ...(parsed.data.responsibleParty !== undefined ? { responsibleParty: parsed.data.responsibleParty?.trim() || null } : {}),
    ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    ...(parsed.data.dueDate !== undefined ? { dueDate: dateString(parsed.data.dueDate) } : {}),
    ...(parsed.data.reviewerName !== undefined ? { reviewerName: parsed.data.reviewerName?.trim() || null } : {}),
    ...(parsed.data.reviewComments !== undefined ? { reviewComments: parsed.data.reviewComments?.trim() || null } : {}),
    submittedAt: submittedTimestamp(status, existing.submittedAt),
    reviewedAt: reviewedTimestamp(status, existing.reviewedAt),
    updatedAt: new Date(),
  }).where(and(
    eq(submittalPackagesTable.id, params.data.submittalId),
    eq(submittalPackagesTable.tenantId, req.tenantId!),
    eq(submittalPackagesTable.environmentId, req.environmentId!),
  ));
  res.json(await serializePackage(req, await getPackageBase(req, params.data.submittalId)));
});

router.delete("/submittals/:submittalId", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const params = DeleteSubmittalPackageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid submittal package id" });
    return;
  }
  const deleted = await db.delete(submittalPackagesTable).where(and(
    eq(submittalPackagesTable.id, params.data.submittalId),
    eq(submittalPackagesTable.tenantId, req.tenantId!),
    eq(submittalPackagesTable.environmentId, req.environmentId!),
  )).returning({ id: submittalPackagesTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Submittal package not found" });
    return;
  }
  res.status(204).send();
});

router.post("/submittals/:submittalId/items", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = CreateSubmittalItemParams.safeParse(req.params);
  const parsed = CreateSubmittalItemBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid submittal item details" });
    return;
  }
  const pkg = await getPackageForMutation(req, params.data.submittalId);
  if (!pkg) {
    res.status(404).json({ error: "Submittal package not found" });
    return;
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(submittalItemsTable)
    .where(and(eq(submittalItemsTable.packageId, pkg.id), eq(submittalItemsTable.tenantId, req.tenantId!), eq(submittalItemsTable.environmentId, req.environmentId!)));
  const [created] = await db.insert(submittalItemsTable).values({
    packageId: pkg.id,
    itemNumber: `${pkg.packageNumber}.${Number(count) + 1}`,
    itemType: parsed.data.itemType ?? "product_data",
    name: parsed.data.name.trim(),
    description: parsed.data.description?.trim() || null,
    status: parsed.data.status ?? "pending",
    documentName: parsed.data.documentName?.trim() || null,
    documentUrl: parsed.data.documentUrl?.trim() || null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  res.status(201).json(serializeItem(created));
});

router.patch("/submittal-items/:itemId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateSubmittalItemParams.safeParse(req.params);
  const parsed = UpdateSubmittalItemBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid submittal item update" });
    return;
  }
  const [existing] = await db.select().from(submittalItemsTable).where(and(
    eq(submittalItemsTable.id, params.data.itemId),
    eq(submittalItemsTable.tenantId, req.tenantId!),
    eq(submittalItemsTable.environmentId, req.environmentId!),
  ));
  if (!existing) {
    res.status(404).json({ error: "Submittal item not found" });
    return;
  }
  const [updated] = await db.update(submittalItemsTable).set({
    ...(parsed.data.itemType !== undefined ? { itemType: parsed.data.itemType } : {}),
    ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.description !== undefined ? { description: parsed.data.description?.trim() || null } : {}),
    ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    ...(parsed.data.documentName !== undefined ? { documentName: parsed.data.documentName?.trim() || null } : {}),
    ...(parsed.data.documentUrl !== undefined ? { documentUrl: parsed.data.documentUrl?.trim() || null } : {}),
    ...(parsed.data.reviewerName !== undefined ? { reviewerName: parsed.data.reviewerName?.trim() || null } : {}),
    ...(parsed.data.reviewComments !== undefined ? { reviewComments: parsed.data.reviewComments?.trim() || null } : {}),
    revision: existing.revision + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(submittalItemsTable.id, params.data.itemId),
    eq(submittalItemsTable.tenantId, req.tenantId!),
    eq(submittalItemsTable.environmentId, req.environmentId!),
  )).returning();
  res.json(serializeItem(updated));
});

router.delete("/submittal-items/:itemId", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const params = DeleteSubmittalItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid submittal item id" });
    return;
  }
  const deleted = await db.delete(submittalItemsTable).where(and(
    eq(submittalItemsTable.id, params.data.itemId),
    eq(submittalItemsTable.tenantId, req.tenantId!),
    eq(submittalItemsTable.environmentId, req.environmentId!),
  )).returning({ id: submittalItemsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Submittal item not found" });
    return;
  }
  res.status(204).send();
});

router.patch("/submittals/:submittalId/items/reorder", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const submittalId = Number(req.params.submittalId);
  const parsed = itemOrderInput.safeParse(req.body);
  if (!Number.isInteger(submittalId) || submittalId < 1 || !parsed.success || new Set(parsed.data.itemIds).size !== parsed.data.itemIds.length) {
    res.status(400).json({ error: "Invalid submittal item order" });
    return;
  }
  const pkg = await getPackageForMutation(req, submittalId);
  if (!pkg) {
    res.status(404).json({ error: "Submittal package not found" });
    return;
  }
  const items = await db.select({ id: submittalItemsTable.id }).from(submittalItemsTable).where(and(
    eq(submittalItemsTable.packageId, pkg.id),
    eq(submittalItemsTable.tenantId, req.tenantId!),
    eq(submittalItemsTable.environmentId, req.environmentId!),
  ));
  const knownIds = new Set(items.map((item) => item.id));
  if (items.length !== parsed.data.itemIds.length || parsed.data.itemIds.some((id) => !knownIds.has(id))) {
    res.status(400).json({ error: "Item order must include every item in this package exactly once" });
    return;
  }
  await Promise.all(parsed.data.itemIds.map((itemId, index) => db.update(submittalItemsTable).set({
    sortOrder: index,
    itemNumber: `${pkg.packageNumber}.${index + 1}`,
    updatedAt: new Date(),
  }).where(and(
    eq(submittalItemsTable.id, itemId),
    eq(submittalItemsTable.packageId, pkg.id),
    eq(submittalItemsTable.tenantId, req.tenantId!),
    eq(submittalItemsTable.environmentId, req.environmentId!),
  ))));
  res.json(await serializePackage(req, await getPackageBase(req, pkg.id)));
});

router.post("/submittal-items/:itemId/documents/request-upload", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  if (rejectUploadRate(req, res)) return;
  const itemId = Number(req.params.itemId);
  const parsed = documentRequestBody.safeParse(req.body);
  if (!Number.isInteger(itemId) || itemId < 1 || !parsed.success || !isAllowedDocumentType(parsed.data.contentType)) {
    res.status(400).json({ error: "Invalid document name, size, or content type" });
    return;
  }
  const [item] = await db.select({ id: submittalItemsTable.id }).from(submittalItemsTable).where(and(
    eq(submittalItemsTable.id, itemId),
    eq(submittalItemsTable.tenantId, req.tenantId!),
    eq(submittalItemsTable.environmentId, req.environmentId!),
  ));
  if (!item) {
    res.status(404).json({ error: "Submittal item not found" });
    return;
  }
  let objectPath: string | undefined;
  try {
    const upload = await objectStorage.requestUpload();
    objectPath = upload.objectPath;
    const [{ maxVersion }] = await db.select({
      maxVersion: sql<number | null>`max(${submittalDocumentsTable.version})`,
    }).from(submittalDocumentsTable).where(and(
      eq(submittalDocumentsTable.itemId, itemId),
      eq(submittalDocumentsTable.tenantId, req.tenantId!),
      eq(submittalDocumentsTable.environmentId, req.environmentId!),
    ));
    const [document] = await db.insert(submittalDocumentsTable).values({
      itemId,
      originalName: sanitizeFileName(parsed.data.originalName),
      objectPath,
      contentType: parsed.data.contentType,
      size: parsed.data.size,
      version: Number(maxVersion ?? 0) + 1,
      uploadedByUserId: req.localUserId!,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    }).returning();
    res.status(201).json({ ...serializeDocument(document), uploadURL: upload.uploadURL });
  } catch (error) {
    if (objectPath) {
      try {
        await objectStorage.deleteObject(objectPath);
      } catch (cleanupError) {
        req.log.warn({ err: cleanupError }, "Unable to clean up failed submittal upload reservation");
      }
    }
    req.log.error({ err: error }, "Failed to create submittal document upload");
    res.status(503).json({ error: "Document storage is temporarily unavailable" });
  }
});

router.get("/submittal-items/:itemId/documents/providers/files", requireRole("owner", "admin", "member"), async (req: TenantRequest, res): Promise<void> => {
  const itemId = Number(req.params.itemId);
  const parsed = documentProviderQuery.safeParse(req.query);
  if (!Number.isInteger(itemId) || itemId < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid document provider query" });
    return;
  }
  const [item] = await db.select({ id: submittalItemsTable.id }).from(submittalItemsTable).where(and(
    eq(submittalItemsTable.id, itemId),
    eq(submittalItemsTable.tenantId, req.tenantId!),
    eq(submittalItemsTable.environmentId, req.environmentId!),
  ));
  if (!item) {
    res.status(404).json({ error: "Submittal item not found" });
    return;
  }
  try {
    if (!await connectedDocumentProvider(req, parsed.data.providerKey)) {
      res.status(424).json({ error: "Google Workspace Drive is not connected for this environment" });
      return;
    }
    res.json(await documentProvider.listFiles(parsed.data.providerKey, parsed.data.search, parsed.data.pageToken));
  } catch (error) {
    const status = error instanceof DocumentProviderError ? error.status : 424;
    req.log.warn({ err: error, itemId }, "Submittal document provider listing unavailable");
    res.status(status).json({ error: "Google Workspace Drive files could not be listed" });
  }
});

router.post("/submittal-items/:itemId/documents/import", requireRole("owner", "admin", "member"), async (req: TenantRequest, res): Promise<void> => {
  if (rejectUploadRate(req, res)) return;
  const itemId = Number(req.params.itemId);
  const parsed = documentProviderInput.safeParse(req.body);
  if (!Number.isInteger(itemId) || itemId < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid external document reference" });
    return;
  }
  const [item] = await db.select({ id: submittalItemsTable.id }).from(submittalItemsTable).where(and(
    eq(submittalItemsTable.id, itemId),
    eq(submittalItemsTable.tenantId, req.tenantId!),
    eq(submittalItemsTable.environmentId, req.environmentId!),
  ));
  if (!item) {
    res.status(404).json({ error: "Submittal item not found" });
    return;
  }
  const integration = await connectedDocumentProvider(req, parsed.data.providerKey);
  if (!integration) {
    res.status(424).json({ error: "Google Workspace Drive is not connected for this environment" });
    return;
  }
  const [existing] = await db.select().from(submittalDocumentsTable).where(and(
    eq(submittalDocumentsTable.itemId, itemId),
    eq(submittalDocumentsTable.tenantId, req.tenantId!),
    eq(submittalDocumentsTable.environmentId, req.environmentId!),
    eq(submittalDocumentsTable.providerKey, parsed.data.providerKey),
    eq(submittalDocumentsTable.externalId, parsed.data.externalId),
  )).limit(1);
  if (existing?.importStatus === "imported" && existing.status === "uploaded") {
    res.status(409).json({ error: "This external document was already imported", documentId: existing.id });
    return;
  }
  if (existing?.importStatus === "importing") {
    res.status(409).json({ error: "This external document is already being imported", documentId: existing.id });
    return;
  }
  let document = existing;
  let objectPath: string | undefined;
  try {
    if (document) {
      [document] = await db.update(submittalDocumentsTable).set({
        importStatus: "importing",
        failureReason: null,
        status: "pending",
      }).where(and(
        eq(submittalDocumentsTable.id, document.id),
        eq(submittalDocumentsTable.tenantId, req.tenantId!),
        eq(submittalDocumentsTable.environmentId, req.environmentId!),
      )).returning();
    } else {
      const [{ maxVersion }] = await db.select({
        maxVersion: sql<number | null>`max(${submittalDocumentsTable.version})`,
      }).from(submittalDocumentsTable).where(and(
        eq(submittalDocumentsTable.itemId, itemId),
        eq(submittalDocumentsTable.tenantId, req.tenantId!),
        eq(submittalDocumentsTable.environmentId, req.environmentId!),
      ));
      [document] = await db.insert(submittalDocumentsTable).values({
        itemId,
        originalName: "external-document",
        objectPath: `/objects/pending-submittal-import-${crypto.randomUUID()}`,
        contentType: "application/octet-stream",
        size: 1,
        version: Number(maxVersion ?? 0) + 1,
        status: "pending",
        providerKey: parsed.data.providerKey,
        externalId: parsed.data.externalId,
        importStatus: "importing",
        uploadedByUserId: req.localUserId!,
        tenantId: req.tenantId!,
        environmentId: req.environmentId!,
      }).returning();
    }
    const imported = await documentProvider.importFile(parsed.data.providerKey, parsed.data.externalId);
    const stored = await objectStorage.storeBytes("submittals", imported.bytes, imported.contentType);
    objectPath = stored.objectPath;
    const storedFile = await objectStorage.getObjectFile(stored.objectPath);
    const screening = await screenStoredDocument(storedFile, imported.contentType, imported.bytes.length);
    if (screening.status === "rejected") {
      await objectStorage.deleteObject(stored.objectPath).catch(() => undefined);
      objectPath = undefined;
      throw new DocumentProviderError("External document failed upload safety screening", screening.reason === "content_mismatch" ? 415 : 422);
    }
    const pageCount = imported.contentType === "application/pdf"
      ? (await PDFDocument.load(imported.bytes)).getPageCount()
      : null;
    const [updated] = await db.update(submittalDocumentsTable).set({
      originalName: imported.name,
      objectPath: stored.objectPath,
      contentType: imported.contentType,
      size: imported.bytes.length,
      pageCount,
      pageOrder: pageCount ? JSON.stringify(Array.from({ length: pageCount }, (_, index) => index + 1)) : null,
      sourceUrl: imported.sourceUrl,
      status: "uploaded",
      importStatus: "imported",
      failureReason: null,
      uploadedAt: new Date(),
    }).where(and(
      eq(submittalDocumentsTable.id, document!.id),
      eq(submittalDocumentsTable.tenantId, req.tenantId!),
      eq(submittalDocumentsTable.environmentId, req.environmentId!),
    )).returning();
    await db.insert(integrationAuditEventsTable).values({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      integrationId: integration.id,
      providerKey: parsed.data.providerKey,
      action: "submittal_document_imported",
      details: JSON.stringify({ itemId, documentId: updated.id, externalId: parsed.data.externalId }),
      actorUserId: req.localUserId!,
    });
    res.status(201).json(serializeDocument(updated));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      const [duplicate] = await db.select({ id: submittalDocumentsTable.id }).from(submittalDocumentsTable).where(and(
        eq(submittalDocumentsTable.itemId, itemId),
        eq(submittalDocumentsTable.tenantId, req.tenantId!),
        eq(submittalDocumentsTable.environmentId, req.environmentId!),
        eq(submittalDocumentsTable.providerKey, parsed.data.providerKey),
        eq(submittalDocumentsTable.externalId, parsed.data.externalId),
      )).limit(1);
      res.status(409).json({ error: "This external document is already being imported", documentId: duplicate?.id });
      return;
    }
    if (objectPath) await objectStorage.deleteObject(objectPath).catch(() => undefined);
    const reason = error instanceof Error ? error.message.slice(0, 500) : "External document import failed";
    if (document) {
      await db.update(submittalDocumentsTable).set({
        importStatus: "failed",
        failureReason: reason,
      }).where(and(
        eq(submittalDocumentsTable.id, document.id),
        eq(submittalDocumentsTable.tenantId, req.tenantId!),
        eq(submittalDocumentsTable.environmentId, req.environmentId!),
      ));
    }
    await db.insert(integrationAuditEventsTable).values({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      integrationId: integration.id,
      providerKey: parsed.data.providerKey,
      action: "submittal_document_import_failed",
      details: JSON.stringify({ itemId, externalId: parsed.data.externalId, reason }),
      actorUserId: req.localUserId!,
    }).catch((auditError) => req.log.warn({ err: auditError }, "Unable to record document import failure audit"));
    const status = error instanceof DocumentProviderError ? error.status : 503;
    req.log.warn({ err: error, itemId, externalId: parsed.data.externalId }, "Submittal document import failed");
    res.status(status).json({ error: "External document could not be imported", retryable: status >= 500 || status === 424 });
  }
});

router.post("/submittal-documents/:documentId/complete", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  if (rejectUploadRate(req, res)) return;
  const documentId = Number(req.params.documentId);
  if (!Number.isInteger(documentId) || documentId < 1) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  const [document] = await db.select().from(submittalDocumentsTable).where(and(
    eq(submittalDocumentsTable.id, documentId),
    eq(submittalDocumentsTable.tenantId, req.tenantId!),
    eq(submittalDocumentsTable.environmentId, req.environmentId!),
  ));
  if (!document) {
    res.status(404).json({ error: "Submittal document not found" });
    return;
  }
  try {
    const file = await objectStorage.getObjectFile(document.objectPath);
    const [metadata] = await file.getMetadata();
    const storedSize = Number(metadata.size ?? 0);
    const storedContentType = typeof metadata.contentType === "string" ? metadata.contentType : null;
    if (storedSize <= 0 || storedSize > document.size) {
      await objectStorage.deleteObject(document.objectPath).catch(() => undefined);
      await db.update(submittalDocumentsTable).set({ status: "rejected" }).where(eq(submittalDocumentsTable.id, document.id));
      res.status(413).json({ error: "Uploaded document exceeds the declared size" });
      return;
    }
    if (storedContentType && storedContentType !== document.contentType) {
      await objectStorage.deleteObject(document.objectPath).catch(() => undefined);
      await db.update(submittalDocumentsTable).set({ status: "rejected" }).where(eq(submittalDocumentsTable.id, document.id));
      res.status(415).json({ error: "Uploaded document content type does not match its declared type" });
      return;
    }
    const screening = await screenStoredDocument(file, document.contentType, storedSize);
    if (screening.status === "rejected") {
      await objectStorage.deleteObject(document.objectPath).catch(() => undefined);
      await db.update(submittalDocumentsTable).set({ status: "rejected" }).where(eq(submittalDocumentsTable.id, document.id));
      const statusCode = screening.reason === "content_mismatch" ? 415 : 422;
      res.status(statusCode).json({ error: "Document failed upload safety screening" });
      return;
    }
    const pageCount = document.contentType === "application/pdf"
      ? (await PDFDocument.load((await file.download())[0])).getPageCount()
      : null;
    const [updated] = await db.update(submittalDocumentsTable).set({
      status: "uploaded",
      uploadedAt: new Date(),
      pageCount,
      pageOrder: pageCount ? JSON.stringify(Array.from({ length: pageCount }, (_, index) => index + 1)) : null,
    }).where(and(
      eq(submittalDocumentsTable.id, document.id),
      eq(submittalDocumentsTable.tenantId, req.tenantId!),
      eq(submittalDocumentsTable.environmentId, req.environmentId!),
    )).returning();
    res.json(serializeDocument(updated));
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(409).json({ error: "Upload has not completed yet" });
      return;
    }
    req.log.error({ err: error }, "Failed to complete submittal document upload");
    res.status(503).json({ error: "Document storage is temporarily unavailable" });
  }
});

router.get("/submittal-documents/:documentId", async (req: TenantRequest, res) => {
  const documentId = Number(req.params.documentId);
  if (!Number.isInteger(documentId) || documentId < 1) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  const [document] = await db.select().from(submittalDocumentsTable).where(and(
    eq(submittalDocumentsTable.id, documentId),
    eq(submittalDocumentsTable.tenantId, req.tenantId!),
    eq(submittalDocumentsTable.environmentId, req.environmentId!),
  ));
  if (!document) {
    res.status(404).json({ error: "Submittal document not found" });
    return;
  }
  if (document.status !== "uploaded") {
    res.status(409).json({ error: "Submittal document is not ready" });
    return;
  }
  try {
    const file = await objectStorage.getObjectFile(document.objectPath);
    const [metadata] = await file.getMetadata();
    const responseContentType = metadata.contentType || document.contentType;
    const canPreviewInline = responseContentType === "application/pdf" || responseContentType.startsWith("image/");
    res.setHeader("Content-Type", responseContentType);
    res.setHeader("Content-Length", String(metadata.size ?? document.size));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${canPreviewInline ? "inline" : "attachment"}; filename="${document.originalName.replace(/["\r\n]/g, "")}"`);
    file.createReadStream().on("error", (error) => {
      req.log.error({ err: error, documentId }, "Failed to stream submittal document");
      if (!res.headersSent) res.status(500).json({ error: "Failed to read document" });
    }).pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Stored document not found" });
      return;
    }
    req.log.error({ err: error, documentId }, "Failed to open submittal document");
    res.status(503).json({ error: "Document storage is temporarily unavailable" });
  }
});

router.delete("/submittal-documents/:documentId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const documentId = Number(req.params.documentId);
  if (!Number.isInteger(documentId) || documentId < 1) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  const [document] = await db.select().from(submittalDocumentsTable).where(and(
    eq(submittalDocumentsTable.id, documentId),
    eq(submittalDocumentsTable.tenantId, req.tenantId!),
    eq(submittalDocumentsTable.environmentId, req.environmentId!),
  ));
  if (!document) {
    res.status(404).json({ error: "Submittal document not found" });
    return;
  }
  try {
    await objectStorage.deleteObject(document.objectPath);
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) {
      req.log.warn({ err: error, documentId }, "Unable to remove stored submittal object");
    }
  }
  await db.delete(submittalDocumentsTable).where(and(
    eq(submittalDocumentsTable.id, documentId),
    eq(submittalDocumentsTable.tenantId, req.tenantId!),
    eq(submittalDocumentsTable.environmentId, req.environmentId!),
  ));
  res.status(204).send();
});

router.patch("/submittal-documents/:documentId/pages", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const documentId = Number(req.params.documentId);
  const parsed = pageOrderInput.safeParse(req.body);
  if (!Number.isInteger(documentId) || documentId < 1 || !parsed.success || new Set(parsed.data.pageOrder).size !== parsed.data.pageOrder.length) {
    res.status(400).json({ error: "Invalid PDF page order" });
    return;
  }
  const [document] = await db.select().from(submittalDocumentsTable).where(and(
    eq(submittalDocumentsTable.id, documentId),
    eq(submittalDocumentsTable.tenantId, req.tenantId!),
    eq(submittalDocumentsTable.environmentId, req.environmentId!),
  ));
  if (!document) {
    res.status(404).json({ error: "Submittal document not found" });
    return;
  }
  if (document.status !== "uploaded" || document.contentType !== "application/pdf" || !document.pageCount) {
    res.status(409).json({ error: "Only uploaded PDF documents can be reorganized" });
    return;
  }
  if (parsed.data.pageOrder.length !== document.pageCount || parsed.data.pageOrder.some((page) => page > document.pageCount!)) {
    res.status(400).json({ error: "Page order must include every page exactly once" });
    return;
  }
  const [updated] = await db.update(submittalDocumentsTable).set({
    pageOrder: JSON.stringify(parsed.data.pageOrder),
  }).where(and(
    eq(submittalDocumentsTable.id, documentId),
    eq(submittalDocumentsTable.tenantId, req.tenantId!),
    eq(submittalDocumentsTable.environmentId, req.environmentId!),
  )).returning();
  res.json(serializeDocument(updated));
});

router.post("/submittals/:submittalId/assemblies", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const submittalId = Number(req.params.submittalId);
  const parsed = assemblyInput.safeParse(req.body);
  if (!Number.isInteger(submittalId) || submittalId < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid package assembly request" });
    return;
  }
  const pkg = await getPackageForMutation(req, submittalId);
  if (!pkg) {
    res.status(404).json({ error: "Submittal package not found" });
    return;
  }
  const itemIds = parsed.data.items.map((item) => item.itemId);
  const documentIds = parsed.data.items.map((item) => item.documentId);
  if (new Set(itemIds).size !== itemIds.length || new Set(documentIds).size !== documentIds.length) {
    res.status(400).json({ error: "Each package item and document may appear only once" });
    return;
  }
  const rows = await db.select({ item: submittalItemsTable, document: submittalDocumentsTable })
    .from(submittalItemsTable)
    .innerJoin(submittalDocumentsTable, and(
      eq(submittalDocumentsTable.itemId, submittalItemsTable.id),
      inArray(submittalDocumentsTable.id, documentIds),
      eq(submittalDocumentsTable.tenantId, req.tenantId!),
      eq(submittalDocumentsTable.environmentId, req.environmentId!),
    ))
    .where(and(
      eq(submittalItemsTable.packageId, pkg.id),
      inArray(submittalItemsTable.id, itemIds),
      eq(submittalItemsTable.tenantId, req.tenantId!),
      eq(submittalItemsTable.environmentId, req.environmentId!),
    ));
  const rowsByDocument = new Map(rows.map((row) => [row.document.id, row]));
  if (rows.length !== parsed.data.items.length || parsed.data.items.some((entry) => rowsByDocument.get(entry.documentId)?.item.id !== entry.itemId)) {
    res.status(400).json({ error: "Every selected document must belong to its selected package item" });
    return;
  }
  const output = await PDFDocument.create();
  const pagePlan: { itemId: number; documentId: number; pageOrder: number[] }[] = [];
  let uploadedObjectPath: string | undefined;
  try {
    for (const entry of parsed.data.items) {
      const row = rowsByDocument.get(entry.documentId)!;
      if (row.document.status !== "uploaded" || row.document.contentType !== "application/pdf") {
        throw new Error("Only uploaded PDF documents can be assembled");
      }
      const [sourceBytes] = await (await objectStorage.getObjectFile(row.document.objectPath)).download();
      const source = await PDFDocument.load(sourceBytes);
      const pageCount = source.getPageCount();
      const pageOrder = entry.pageOrder ?? (row.document.pageOrder ? JSON.parse(row.document.pageOrder) as number[] : Array.from({ length: pageCount }, (_, index) => index + 1));
      if (pageOrder.length !== pageCount || new Set(pageOrder).size !== pageCount || pageOrder.some((page) => page < 1 || page > pageCount)) {
        throw new Error(`Invalid page order for ${row.document.originalName}`);
      }
      const pages = await output.copyPages(source, pageOrder.map((page) => page - 1));
      pages.forEach((page) => output.addPage(page));
      pagePlan.push({ itemId: entry.itemId, documentId: entry.documentId, pageOrder });
    }
    const pdfBytes = await output.save();
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(submittalPackageAssembliesTable).where(and(
      eq(submittalPackageAssembliesTable.packageId, pkg.id),
      eq(submittalPackageAssembliesTable.tenantId, req.tenantId!),
      eq(submittalPackageAssembliesTable.environmentId, req.environmentId!),
    ));
    const version = Number(count) + 1;
    const upload = await objectStorage.requestUpload();
    uploadedObjectPath = upload.objectPath;
    const uploadResponse = await fetch(upload.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf", "Content-Length": String(pdfBytes.length) },
      body: Buffer.from(pdfBytes),
      signal: AbortSignal.timeout(60_000),
    });
    if (!uploadResponse.ok) throw new Error(`Failed to store assembled package (${uploadResponse.status})`);
    const [assembly] = await db.insert(submittalPackageAssembliesTable).values({
      packageId: pkg.id,
      version,
      status: "ready",
      originalFileName: `${pkg.packageNumber}-assembled-v${version}.pdf`,
      objectPath: upload.objectPath,
      contentType: "application/pdf",
      size: pdfBytes.length,
      itemOrder: JSON.stringify(itemIds),
      pagePlan: JSON.stringify(pagePlan),
      createdByUserId: req.localUserId!,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    }).returning();
    res.status(201).json(serializeAssembly(assembly));
  } catch (error) {
    if (uploadedObjectPath) {
      await objectStorage.deleteObject(uploadedObjectPath).catch(() => undefined);
    }
    req.log.warn({ err: error, submittalId }, "Failed to assemble submittal package");
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to assemble submittal package" });
  }
});

router.get("/submittal-assemblies/:assemblyId", async (req: TenantRequest, res) => {
  const assemblyId = Number(req.params.assemblyId);
  if (!Number.isInteger(assemblyId) || assemblyId < 1) {
    res.status(400).json({ error: "Invalid assembly id" });
    return;
  }
  const [assembly] = await db.select().from(submittalPackageAssembliesTable).where(and(
    eq(submittalPackageAssembliesTable.id, assemblyId),
    eq(submittalPackageAssembliesTable.tenantId, req.tenantId!),
    eq(submittalPackageAssembliesTable.environmentId, req.environmentId!),
  ));
  if (!assembly) {
    res.status(404).json({ error: "Assembled package not found" });
    return;
  }
  try {
    const file = await objectStorage.getObjectFile(assembly.objectPath);
    res.setHeader("Content-Type", assembly.contentType);
    res.setHeader("Content-Length", String(assembly.size));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${assembly.originalFileName.replace(/["\r\n]/g, "")}"`);
    file.createReadStream().pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Assembled package file not found" });
      return;
    }
    req.log.error({ err: error, assemblyId }, "Failed to open assembled package");
    res.status(503).json({ error: "Package storage is temporarily unavailable" });
  }
});

router.post("/submittal-assemblies/:assemblyId/signature-ready", requireRole("owner", "admin", "member"), async (req: TenantRequest, res): Promise<void> => {
  const params = MarkSubmittalAssemblySignatureReadyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid assembly id" });
    return;
  }
  const [assembly] = await db.select().from(submittalPackageAssembliesTable).where(and(
    eq(submittalPackageAssembliesTable.id, params.data.assemblyId),
    eq(submittalPackageAssembliesTable.tenantId, req.tenantId!),
    eq(submittalPackageAssembliesTable.environmentId, req.environmentId!),
  ));
  if (!assembly) {
    res.status(404).json({ error: "Assembled package not found" });
    return;
  }
  if (assembly.status !== "ready") {
    res.status(409).json({ error: "Only a completed assembled package can be marked signature-ready" });
    return;
  }
  const [updated] = await db.update(submittalPackageAssembliesTable).set({
    signatureReady: true,
    signatureReadyAt: assembly.signatureReadyAt ?? new Date(),
    signatureReadyByUserId: assembly.signatureReadyByUserId ?? req.localUserId!,
  }).where(and(
    eq(submittalPackageAssembliesTable.id, assembly.id),
    eq(submittalPackageAssembliesTable.tenantId, req.tenantId!),
    eq(submittalPackageAssembliesTable.environmentId, req.environmentId!),
  )).returning();
  req.log.info({ assemblyId: assembly.id, packageId: assembly.packageId }, "Marked submittal assembly signature-ready");
  res.json(serializeAssembly(updated));
});

router.get("/submittals/:submittalId/signature-requests", async (req: TenantRequest, res): Promise<void> => {
  const params = ListSubmittalSignatureRequestsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid submittal package id" });
    return;
  }
  const pkg = await getPackageForMutation(req, params.data.submittalId);
  if (!pkg) {
    res.status(404).json({ error: "Submittal package not found" });
    return;
  }
  res.json(await loadSignatureRequests(req, pkg.id));
});

router.post("/submittals/:submittalId/signature-requests", requireRole("owner", "admin", "member"), async (req: TenantRequest, res): Promise<void> => {
  const params = CreateSubmittalSignatureRequestParams.safeParse(req.params);
  const parsed = CreateSubmittalSignatureRequestBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid signature preparation details" });
    return;
  }
  const pkg = await getPackageForMutation(req, params.data.submittalId);
  if (!pkg) {
    res.status(404).json({ error: "Submittal package not found" });
    return;
  }
  const [assembly] = await db.select().from(submittalPackageAssembliesTable).where(and(
    eq(submittalPackageAssembliesTable.id, parsed.data.assemblyId),
    eq(submittalPackageAssembliesTable.packageId, pkg.id),
    eq(submittalPackageAssembliesTable.tenantId, req.tenantId!),
    eq(submittalPackageAssembliesTable.environmentId, req.environmentId!),
  ));
  if (!assembly) {
    res.status(404).json({ error: "Assembled package not found in this submittal" });
    return;
  }
  if (assembly.status !== "ready" || !assembly.signatureReady) {
    res.status(409).json({ error: "Mark this assembled package version signature-ready before preparing signers" });
    return;
  }
  const signerValidation = validateAndNormalizeSignatureSigners(parsed.data.signers);
  if (!signerValidation.ok) {
    res.status(400).json({ error: signerValidation.error });
    return;
  }
  const [activeRequest] = await db.select({ id: submittalSignatureRequestsTable.id }).from(submittalSignatureRequestsTable).where(and(
    eq(submittalSignatureRequestsTable.packageId, pkg.id),
    eq(submittalSignatureRequestsTable.assemblyId, assembly.id),
    eq(submittalSignatureRequestsTable.tenantId, req.tenantId!),
    eq(submittalSignatureRequestsTable.environmentId, req.environmentId!),
    inArray(submittalSignatureRequestsTable.status, [...activeSignatureRequestStatuses]),
  )).limit(1);
  if (activeRequest) {
    res.status(409).json({ error: "This assembled package version already has an active signature request" });
    return;
  }
  const title = parsed.data.title?.trim() || `${pkg.name} · Version ${assembly.version}`;
  const request = await db.transaction(async (tx) => {
    const [created] = await tx.insert(submittalSignatureRequestsTable).values({
      packageId: pkg.id,
      assemblyId: assembly.id,
      title,
      status: "draft",
      providerKey: null,
      providerRequestId: null,
      externalMetadata: "{}",
      createdByUserId: req.localUserId!,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    }).returning();
    await tx.insert(submittalSignatureSignersTable).values(signerValidation.signers.map((signer) => ({
      requestId: created.id,
      name: signer.name,
      email: signer.email,
      role: signer.role,
      signingOrder: signer.signingOrder,
      status: "pending",
      providerSignerId: null,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    })));
    await tx.insert(submittalSignatureEventsTable).values({
      requestId: created.id,
      eventType: "request_prepared",
      fromStatus: null,
      toStatus: "draft",
      details: JSON.stringify({ assemblyId: assembly.id, signerCount: parsed.data.signers.length }),
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    });
    return created;
  });
  req.log.info({ signatureRequestId: request.id, packageId: pkg.id, assemblyId: assembly.id }, "Prepared provider-neutral submittal signature request");
  const requests = await loadSignatureRequests(req, pkg.id);
  const response = requests.find((candidate) => candidate.id === request.id);
  if (!response) {
    res.status(503).json({ error: "Signature request was created but could not be loaded" });
    return;
  }
  res.status(201).json(response);
});

router.post("/submittal-signature-requests/:requestId/send", requireRole("owner", "admin", "member"), async (req: TenantRequest, res): Promise<void> => {
  const params = signatureRequestParams.safeParse(req.params);
  const parsed = sendSignatureRequestInput.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid signature send details" });
    return;
  }
  const rateKey = `${req.tenantId}:${req.environmentId}:${req.localUserId}`;
  const now = Date.now();
  const previous = signatureSendAttempts.get(rateKey);
  if (!previous || previous.resetAt <= now) {
    signatureSendAttempts.set(rateKey, { count: 1, resetAt: now + signatureSendRateWindowMs });
  } else if (previous.count >= signatureSendRateLimit) {
    res.setHeader("Retry-After", String(Math.ceil((previous.resetAt - now) / 1000)));
    res.status(429).json({ error: "Too many signature send attempts. Try again shortly." });
    return;
  } else {
    previous.count += 1;
  }
  const connectedProviders = await getConnectedSignatureProviders(req);
  const selectedProvider = connectedProviders.find((provider) => provider.providerKey === parsed.data.providerKey);
  const provider = selectedProvider ? getSignatureProvider(selectedProvider.providerKey) : undefined;
  if (!selectedProvider || !provider) {
    res.status(409).json({ error: "The selected e-signature provider is not connected, entitled, or available" });
    return;
  }
  const [request] = await db.select().from(submittalSignatureRequestsTable).where(and(
    eq(submittalSignatureRequestsTable.id, params.data.requestId),
    eq(submittalSignatureRequestsTable.tenantId, req.tenantId!),
    eq(submittalSignatureRequestsTable.environmentId, req.environmentId!),
  ));
  if (!request) {
    res.status(404).json({ error: "Signature request not found" });
    return;
  }
  if (!["draft", "ready"].includes(request.status) || request.providerRequestId) {
    res.status(409).json({ error: "This signature request cannot be sent in its current state" });
    return;
  }
  const [assembly] = await db.select().from(submittalPackageAssembliesTable).where(and(
    eq(submittalPackageAssembliesTable.id, request.assemblyId),
    eq(submittalPackageAssembliesTable.packageId, request.packageId),
    eq(submittalPackageAssembliesTable.tenantId, req.tenantId!),
    eq(submittalPackageAssembliesTable.environmentId, req.environmentId!),
  ));
  const signers = await db.select().from(submittalSignatureSignersTable)
    .where(and(
      eq(submittalSignatureSignersTable.requestId, request.id),
      eq(submittalSignatureSignersTable.tenantId, req.tenantId!),
      eq(submittalSignatureSignersTable.environmentId, req.environmentId!),
    ))
    .orderBy(submittalSignatureSignersTable.signingOrder, submittalSignatureSignersTable.id);
  if (!assembly || assembly.status !== "ready" || !assembly.signatureReady || signers.length === 0) {
    res.status(409).json({ error: "The signature-ready package version or signer list is unavailable" });
    return;
  }
  const [claimed] = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(submittalSignatureRequestsTable).where(and(
      eq(submittalSignatureRequestsTable.id, request.id),
      eq(submittalSignatureRequestsTable.tenantId, req.tenantId!),
      eq(submittalSignatureRequestsTable.environmentId, req.environmentId!),
    )).for("update").limit(1);
    if (!locked || !["draft", "ready"].includes(locked.status) || locked.providerRequestId) return [];
    const [updated] = await tx.update(submittalSignatureRequestsTable).set({
      status: "sending",
      providerKey: selectedProvider.providerKey,
    }).where(and(
      eq(submittalSignatureRequestsTable.id, locked.id),
      eq(submittalSignatureRequestsTable.status, locked.status),
      eq(submittalSignatureRequestsTable.tenantId, req.tenantId!),
      eq(submittalSignatureRequestsTable.environmentId, req.environmentId!),
    )).returning();
    if (!updated) return [];
    await tx.insert(submittalSignatureEventsTable).values({
      requestId: updated.id,
      eventType: "send_started",
      fromStatus: locked.status,
      toStatus: "sending",
      details: JSON.stringify({ providerKey: selectedProvider.providerKey }),
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    });
    return [updated];
  });
  if (!claimed) {
    res.status(409).json({ error: "This signature request is already being sent or has already been sent" });
    return;
  }

  let sent: Awaited<ReturnType<typeof provider.send>>;
  try {
    const file = await objectStorage.getObjectFile(assembly.objectPath);
    const [documentBytes] = await file.download();
    sent = await provider.send({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      integrationId: selectedProvider.integrationId,
    }, {
      title: request.title,
      fileName: assembly.originalFileName,
      contentType: assembly.contentType,
      documentBytes,
      signers: signers.map((signer) => ({
        name: signer.name,
        email: signer.email,
        role: signer.role,
        signingOrder: signer.signingOrder,
      })),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 240) : "Signature provider send failed";
    await db.transaction(async (tx) => {
      await tx.update(submittalSignatureRequestsTable).set({
        status: "ready",
      }).where(and(
        eq(submittalSignatureRequestsTable.id, request.id),
        eq(submittalSignatureRequestsTable.status, "sending"),
        eq(submittalSignatureRequestsTable.tenantId, req.tenantId!),
        eq(submittalSignatureRequestsTable.environmentId, req.environmentId!),
      ));
      await tx.insert(submittalSignatureEventsTable).values({
        requestId: request.id,
        eventType: "send_failed",
        fromStatus: "sending",
        toStatus: "ready",
        details: JSON.stringify({ reason }),
        actorUserId: req.localUserId!,
        tenantId: req.tenantId!,
        environmentId: req.environmentId!,
      });
    });
    req.log.warn({ signatureRequestId: request.id, providerKey: selectedProvider.providerKey }, "Signature provider send failed");
    res.status(502).json({ error: "The e-signature provider could not accept this request" });
    return;
  }

  const metadata = { ...parseObject(request.externalMetadata), ...(sent.metadata ?? {}) };
  await db.transaction(async (tx) => {
    await tx.update(submittalSignatureRequestsTable).set({
      status: "sent",
      providerKey: selectedProvider.providerKey,
      providerRequestId: sent.providerRequestId,
      externalMetadata: JSON.stringify(metadata),
    }).where(and(
      eq(submittalSignatureRequestsTable.id, request.id),
      eq(submittalSignatureRequestsTable.status, "sending"),
      eq(submittalSignatureRequestsTable.tenantId, req.tenantId!),
      eq(submittalSignatureRequestsTable.environmentId, req.environmentId!),
    ));
    await tx.insert(submittalSignatureEventsTable).values({
      requestId: request.id,
      eventType: "request_sent",
      fromStatus: "sending",
      toStatus: "sent",
      details: JSON.stringify({ providerKey: selectedProvider.providerKey }),
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    });
  });
  const response = (await loadSignatureRequests(req, request.packageId)).find((candidate) => candidate.id === request.id);
  res.json(response);
});

router.post("/submittal-signature-requests/:requestId/status", requireRole("owner", "admin", "member"), async (req: TenantRequest, res): Promise<void> => {
  const params = signatureRequestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid signature request id" });
    return;
  }
  const [request] = await db.select().from(submittalSignatureRequestsTable).where(and(
    eq(submittalSignatureRequestsTable.id, params.data.requestId),
    eq(submittalSignatureRequestsTable.tenantId, req.tenantId!),
    eq(submittalSignatureRequestsTable.environmentId, req.environmentId!),
  ));
  if (!request) {
    res.status(404).json({ error: "Signature request not found" });
    return;
  }
  const connectedProvider = (await getConnectedSignatureProviders(req)).find((provider) => provider.providerKey === request.providerKey);
  const provider = connectedProvider ? getSignatureProvider(connectedProvider.providerKey) : undefined;
  if (!connectedProvider || !provider || !request.providerRequestId || !request.providerKey || !canTransitionSignatureRequestStatus(request.status as SignatureRequestStatus, request.status as SignatureRequestStatus)) {
    res.status(409).json({ error: "This signature request cannot be polled until its provider is connected and it has been sent" });
    return;
  }
  let result: Awaited<ReturnType<typeof provider.getStatus>>;
  try {
    result = await provider.getStatus({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      integrationId: connectedProvider.integrationId,
    }, request.providerRequestId);
  } catch (error) {
    req.log.warn({ signatureRequestId: request.id, providerKey: request.providerKey }, "Signature provider status poll failed");
    res.status(502).json({ error: "The e-signature provider status could not be retrieved" });
    return;
  }
  if (!signatureRequestStatuses.includes(result.status as SignatureRequestStatus)) {
    res.status(502).json({ error: "The e-signature provider returned an unsupported status" });
    return;
  }
  const nextStatus = result.status as SignatureRequestStatus;
  if (!canTransitionSignatureRequestStatus(request.status as SignatureRequestStatus, nextStatus)) {
    res.status(409).json({ error: "The provider status cannot be applied to this request" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(submittalSignatureRequestsTable).set({
      status: nextStatus,
      externalMetadata: JSON.stringify({ ...parseObject(request.externalMetadata), ...(result.metadata ?? {}) }),
    }).where(and(
      eq(submittalSignatureRequestsTable.id, request.id),
      eq(submittalSignatureRequestsTable.tenantId, req.tenantId!),
      eq(submittalSignatureRequestsTable.environmentId, req.environmentId!),
    ));
    await tx.insert(submittalSignatureEventsTable).values({
      requestId: request.id,
      eventType: "status_polled",
      fromStatus: request.status,
      toStatus: nextStatus,
      details: JSON.stringify(result.metadata ?? {}),
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    });
  });
  res.json((await loadSignatureRequests(req, request.packageId)).find((candidate) => candidate.id === request.id));
});

router.post("/submittal-signature-requests/:requestId/cancel", requireRole("owner", "admin", "member"), async (req: TenantRequest, res): Promise<void> => {
  const params = signatureRequestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid signature request id" });
    return;
  }
  const [request] = await db.select().from(submittalSignatureRequestsTable).where(and(
    eq(submittalSignatureRequestsTable.id, params.data.requestId),
    eq(submittalSignatureRequestsTable.tenantId, req.tenantId!),
    eq(submittalSignatureRequestsTable.environmentId, req.environmentId!),
  ));
  if (!request) {
    res.status(404).json({ error: "Signature request not found" });
    return;
  }
  if (!["draft", "ready", "sent", "partially_signed"].includes(request.status)) {
    res.status(409).json({ error: "This signature request cannot be canceled in its current state" });
    return;
  }
  if (request.providerKey && request.providerRequestId) {
    const connectedProvider = (await getConnectedSignatureProviders(req)).find((provider) => provider.providerKey === request.providerKey);
    const provider = connectedProvider ? getSignatureProvider(connectedProvider.providerKey) : undefined;
    if (!connectedProvider || !provider) {
      res.status(409).json({ error: "The signature provider is no longer connected or available" });
      return;
    }
    try {
      await provider.cancel({
        tenantId: req.tenantId!,
        environmentId: req.environmentId!,
        integrationId: connectedProvider.integrationId,
      }, request.providerRequestId);
    } catch {
      res.status(502).json({ error: "The e-signature provider could not cancel this request" });
      return;
    }
  }
  if (!canTransitionSignatureRequestStatus(request.status as SignatureRequestStatus, "canceled")) {
    res.status(409).json({ error: "This signature request cannot be canceled in its current state" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(submittalSignatureRequestsTable).set({ status: "canceled" }).where(and(
      eq(submittalSignatureRequestsTable.id, request.id),
      eq(submittalSignatureRequestsTable.tenantId, req.tenantId!),
      eq(submittalSignatureRequestsTable.environmentId, req.environmentId!),
    ));
    await tx.insert(submittalSignatureEventsTable).values({
      requestId: request.id,
      eventType: "request_canceled",
      fromStatus: request.status,
      toStatus: "canceled",
      details: JSON.stringify({ providerKey: request.providerKey }),
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    });
  });
  res.json((await loadSignatureRequests(req, request.packageId)).find((candidate) => candidate.id === request.id));
});

router.get("/submittal-signature-requests/:requestId/signed-document", async (req: TenantRequest, res): Promise<void> => {
  const params = signatureRequestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid signature request id" });
    return;
  }
  const [request] = await db.select().from(submittalSignatureRequestsTable).where(and(
    eq(submittalSignatureRequestsTable.id, params.data.requestId),
    eq(submittalSignatureRequestsTable.tenantId, req.tenantId!),
    eq(submittalSignatureRequestsTable.environmentId, req.environmentId!),
  ));
  if (!request) {
    res.status(404).json({ error: "Signature request not found" });
    return;
  }
  if (request.status !== "completed") {
    res.status(409).json({ error: "The signed document is available after all signers complete the request" });
    return;
  }
  const metadata = parseObject(request.externalMetadata);
  const storedDocument = metadata.signedDocument;
  let objectPath = storedDocument && typeof storedDocument === "object" && !Array.isArray(storedDocument)
    ? (storedDocument as { objectPath?: unknown }).objectPath
    : undefined;
  let fileName = storedDocument && typeof storedDocument === "object" && !Array.isArray(storedDocument)
    ? (storedDocument as { fileName?: unknown }).fileName
    : undefined;
  let contentType = storedDocument && typeof storedDocument === "object" && !Array.isArray(storedDocument)
    ? (storedDocument as { contentType?: unknown }).contentType
    : undefined;
  try {
    if (typeof objectPath !== "string") {
      const connectedProvider = (await getConnectedSignatureProviders(req)).find((provider) => provider.providerKey === request.providerKey);
      const provider = connectedProvider ? getSignatureProvider(connectedProvider.providerKey) : undefined;
      if (!connectedProvider || !provider || !request.providerKey || !request.providerRequestId) {
        res.status(409).json({ error: "The signature provider is no longer connected or available" });
        return;
      }
      const downloaded = await provider.downloadSignedDocument({
        tenantId: req.tenantId!,
        environmentId: req.environmentId!,
        integrationId: connectedProvider.integrationId,
      }, request.providerRequestId);
      fileName = downloaded.fileName;
      contentType = downloaded.contentType;
      if (downloaded.bytes) {
        objectPath = (await objectStorage.storeBytes("submittal-signatures", downloaded.bytes, downloaded.contentType)).objectPath;
      } else {
        objectPath = downloaded.objectPath;
      }
      if (typeof objectPath !== "string") throw new Error("Signature provider returned no document");
      const updatedMetadata = {
        ...metadata,
        signedDocument: {
          objectPath,
          fileName: typeof fileName === "string" ? fileName : "signed-document.pdf",
          contentType: typeof contentType === "string" ? contentType : "application/pdf",
          retrievedAt: new Date().toISOString(),
        },
      };
      await db.transaction(async (tx) => {
        await tx.update(submittalSignatureRequestsTable).set({
          externalMetadata: JSON.stringify(updatedMetadata),
        }).where(and(
          eq(submittalSignatureRequestsTable.id, request.id),
          eq(submittalSignatureRequestsTable.tenantId, req.tenantId!),
          eq(submittalSignatureRequestsTable.environmentId, req.environmentId!),
        ));
        await tx.insert(submittalSignatureEventsTable).values({
          requestId: request.id,
          eventType: "signed_document_retrieved",
          fromStatus: request.status,
          toStatus: request.status,
          details: JSON.stringify({ providerKey: request.providerKey }),
          actorUserId: req.localUserId!,
          tenantId: req.tenantId!,
          environmentId: req.environmentId!,
        });
      });
    }
    if (typeof objectPath !== "string") throw new Error("Signed document path is unavailable");
    const file = await objectStorage.getObjectFile(objectPath);
    res.setHeader("Content-Type", typeof contentType === "string" ? contentType : "application/pdf");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFileName(typeof fileName === "string" ? fileName : "signed-document.pdf")}"`);
    file.createReadStream().pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Signed document is no longer available" });
      return;
    }
    req.log.error({ err: error, signatureRequestId: request.id }, "Failed to retrieve signed document");
    res.status(503).json({ error: "Signed document retrieval is temporarily unavailable" });
  }
});

router.post("/submittals/:submittalId/revisions", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = CreateSubmittalRevisionParams.safeParse(req.params);
  const parsed = CreateSubmittalRevisionBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid submittal revision details" });
    return;
  }
  const pkg = await getPackageForMutation(req, params.data.submittalId);
  if (!pkg) {
    res.status(404).json({ error: "Submittal package not found" });
    return;
  }
  const revision = pkg.revision + 1;
  const now = new Date();
  const [created] = await db.insert(submittalRevisionsTable).values({
    packageId: pkg.id,
    revision,
    status: parsed.data.status,
    reviewerName: parsed.data.reviewerName?.trim() || null,
    reviewComments: parsed.data.reviewComments?.trim() || null,
    submittedAt: submittedTimestamp(parsed.data.status, null),
    reviewedAt: reviewedTimestamp(parsed.data.status, null),
    createdByUserId: req.localUserId!,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await db.update(submittalPackagesTable).set({
    revision,
    status: parsed.data.status,
    reviewerName: parsed.data.reviewerName?.trim() || null,
    reviewComments: parsed.data.reviewComments?.trim() || null,
    submittedAt: submittedTimestamp(parsed.data.status, pkg.submittedAt),
    reviewedAt: reviewedTimestamp(parsed.data.status, pkg.reviewedAt),
    updatedAt: now,
  }).where(and(
    eq(submittalPackagesTable.id, pkg.id),
    eq(submittalPackagesTable.tenantId, req.tenantId!),
    eq(submittalPackagesTable.environmentId, req.environmentId!),
  ));
  res.status(201).json(serializeRevision(created));
});

router.get("/submittals/:submittalId/transmittals", async (req: TenantRequest, res) => {
  const submittalId = Number(req.params.submittalId);
  if (!Number.isInteger(submittalId) || submittalId < 1) {
    res.status(400).json({ error: "Invalid submittal package id" });
    return;
  }
  const pkg = await getPackageBase(req, submittalId);
  if (!pkg) {
    res.status(404).json({ error: "Submittal package not found" });
    return;
  }
  const records = await db.select().from(submittalTransmittalsTable).where(and(
    eq(submittalTransmittalsTable.packageId, submittalId),
    eq(submittalTransmittalsTable.tenantId, req.tenantId!),
    eq(submittalTransmittalsTable.environmentId, req.environmentId!),
  )).orderBy(desc(submittalTransmittalsTable.sentAt), desc(submittalTransmittalsTable.id));
  res.json(records.map(serializeTransmittal));
});

router.post("/submittals/:submittalId/transmittals", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const submittalId = Number(req.params.submittalId);
  const parsed = transmittalInput.safeParse(req.body);
  if (!Number.isInteger(submittalId) || submittalId < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid submittal transmittal details" });
    return;
  }
  const pkg = await getPackageForMutation(req, submittalId);
  if (!pkg) {
    res.status(404).json({ error: "Submittal package not found" });
    return;
  }
  if (parsed.data.revisionId && !(await getRevisionInPackage(req, pkg.id, parsed.data.revisionId))) {
    res.status(400).json({ error: "Revision does not belong to this submittal package" });
    return;
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(submittalTransmittalsTable).where(and(
    eq(submittalTransmittalsTable.packageId, pkg.id),
    eq(submittalTransmittalsTable.tenantId, req.tenantId!),
    eq(submittalTransmittalsTable.environmentId, req.environmentId!),
  ));
  const [created] = await db.insert(submittalTransmittalsTable).values({
    packageId: pkg.id,
    revisionId: parsed.data.revisionId ?? null,
    transmittalNumber: parsed.data.transmittalNumber || `TRN-${pkg.packageNumber}-${String(Number(count) + 1).padStart(2, "0")}`,
    purpose: parsed.data.purpose ?? "review",
    dueDate: parsed.data.dueDate || null,
    fromParty: parsed.data.fromParty || null,
    toParty: parsed.data.toParty || null,
    notes: parsed.data.notes || null,
    createdByUserId: req.localUserId!,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  res.status(201).json(serializeTransmittal(created));
});

router.get("/submittals/:submittalId/coordination", async (req: TenantRequest, res) => {
  const submittalId = Number(req.params.submittalId);
  if (!Number.isInteger(submittalId) || submittalId < 1) {
    res.status(400).json({ error: "Invalid submittal package id" });
    return;
  }
  const pkg = await getPackageBase(req, submittalId);
  if (!pkg) {
    res.status(404).json({ error: "Submittal package not found" });
    return;
  }
  const records = await db.select().from(submittalCoordinationTable).where(and(
    eq(submittalCoordinationTable.packageId, submittalId),
    eq(submittalCoordinationTable.tenantId, req.tenantId!),
    eq(submittalCoordinationTable.environmentId, req.environmentId!),
  )).orderBy(desc(submittalCoordinationTable.updatedAt));
  res.json(records.map(serializeCoordination));
});

router.post("/submittals/:submittalId/coordination", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const submittalId = Number(req.params.submittalId);
  const parsed = coordinationInput.safeParse(req.body);
  if (!Number.isInteger(submittalId) || submittalId < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid coordination details" });
    return;
  }
  const pkg = await getPackageForMutation(req, submittalId);
  if (!pkg) {
    res.status(404).json({ error: "Submittal package not found" });
    return;
  }
  if (parsed.data.revisionId && !(await getRevisionInPackage(req, pkg.id, parsed.data.revisionId))) {
    res.status(400).json({ error: "Revision does not belong to this submittal package" });
    return;
  }
  const [created] = await db.insert(submittalCoordinationTable).values({
    packageId: pkg.id,
    revisionId: parsed.data.revisionId ?? null,
    coordinationType: parsed.data.coordinationType,
    status: parsed.data.status ?? "pending",
    ownerName: parsed.data.ownerName || null,
    externalReference: parsed.data.externalReference || null,
    notes: parsed.data.notes || null,
    dueDate: parsed.data.dueDate ?? null,
    failureReason: parsed.data.failureReason || null,
    createdByUserId: req.localUserId!,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  res.status(201).json(serializeCoordination(created));
});

router.patch("/submittal-coordination/:coordinationId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const coordinationId = Number(req.params.coordinationId);
  const parsed = coordinationUpdate.safeParse(req.body);
  if (!Number.isInteger(coordinationId) || coordinationId < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid coordination update" });
    return;
  }
  const [existing] = await db.select().from(submittalCoordinationTable).where(and(
    eq(submittalCoordinationTable.id, coordinationId),
    eq(submittalCoordinationTable.tenantId, req.tenantId!),
    eq(submittalCoordinationTable.environmentId, req.environmentId!),
  ));
  if (!existing) {
    res.status(404).json({ error: "Coordination record not found" });
    return;
  }
  if (parsed.data.revisionId && !(await getRevisionInPackage(req, existing.packageId, parsed.data.revisionId))) {
    res.status(400).json({ error: "Revision does not belong to this submittal package" });
    return;
  }
  const [updated] = await db.update(submittalCoordinationTable).set({
    ...(parsed.data.revisionId !== undefined ? { revisionId: parsed.data.revisionId } : {}),
    ...(parsed.data.coordinationType !== undefined ? { coordinationType: parsed.data.coordinationType } : {}),
    ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    ...(parsed.data.ownerName !== undefined ? { ownerName: parsed.data.ownerName || null } : {}),
    ...(parsed.data.externalReference !== undefined ? { externalReference: parsed.data.externalReference || null } : {}),
    ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
    ...(parsed.data.dueDate !== undefined ? { dueDate: parsed.data.dueDate } : {}),
    ...(parsed.data.failureReason !== undefined ? { failureReason: parsed.data.failureReason || null } : {}),
    updatedAt: new Date(),
  }).where(and(
    eq(submittalCoordinationTable.id, coordinationId),
    eq(submittalCoordinationTable.tenantId, req.tenantId!),
    eq(submittalCoordinationTable.environmentId, req.environmentId!),
  )).returning();
  res.json(serializeCoordination(updated));
});

router.delete("/submittal-coordination/:coordinationId", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const coordinationId = Number(req.params.coordinationId);
  if (!Number.isInteger(coordinationId) || coordinationId < 1) {
    res.status(400).json({ error: "Invalid coordination id" });
    return;
  }
  const deleted = await db.delete(submittalCoordinationTable).where(and(
    eq(submittalCoordinationTable.id, coordinationId),
    eq(submittalCoordinationTable.tenantId, req.tenantId!),
    eq(submittalCoordinationTable.environmentId, req.environmentId!),
  )).returning({ id: submittalCoordinationTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Coordination record not found" });
    return;
  }
  res.status(204).send();
});

export default router;