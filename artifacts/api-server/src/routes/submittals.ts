import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bidsTable,
  businessCustomersTable,
  db,
  platformAuditEventsTable,
  projectsTable,
  submittalDocumentsTable,
  submittalItemsTable,
  submittalPackagesTable,
  submittalRevisionsTable,
} from "@workspace/db";
import {
  CreateSubmittalItemBody,
  CreateSubmittalItemParams,
  CreateSubmittalPackageBody,
  CreateSubmittalRevisionBody,
  CreateSubmittalRevisionParams,
  DeleteSubmittalItemParams,
  DeleteSubmittalPackageParams,
  GetSubmittalPackageParams,
  ListSubmittalPackagesQueryParams,
  UpdateSubmittalItemBody,
  UpdateSubmittalItemParams,
  UpdateSubmittalPackageBody,
  UpdateSubmittalPackageParams,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { screenStoredDocument } from "../lib/documentScreening";

const router: IRouter = Router();

const packageStatuses = ["draft", "submitted", "under_review", "approved", "approved_as_noted", "revise_and_resubmit", "rejected", "superseded"] as const;
const originTypes = ["contract", "accepted_substitution", "accepted_alternate", "early_procurement"] as const;
const itemTypes = ["shop_drawing", "product_data", "sample", "mockup", "calculation", "certificate", "warranty", "closeout", "other"] as const;
const itemStatuses = ["pending", "included", "needs_revision", "accepted", "superseded"] as const;
const objectStorage = new ObjectStorageService();
const maxDocumentSize = 100 * 1024 * 1024;
const uploadRateWindowMs = 60_000;
const uploadRateLimit = 20;
const uploadAttempts = new Map<string, { count: number; resetAt: number }>();
const documentRequestBody = z.object({
  originalName: z.string().trim().min(1).max(255),
  size: z.number().int().min(1).max(maxDocumentSize),
  contentType: z.string().trim().min(1).max(160),
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
  version: document.version,
  status: document.status,
  uploadedAt: document.uploadedAt,
  createdAt: document.createdAt,
  downloadUrl: `/api/submittal-documents/${document.id}`,
});

const serializeItem = (
  item: typeof submittalItemsTable.$inferSelect,
  documents: typeof submittalDocumentsTable.$inferSelect[] = [],
) => ({
  id: item.id,
  packageId: item.packageId,
  itemNumber: item.itemNumber,
  itemType: item.itemType,
  name: item.name,
  description: item.description,
  status: item.status,
  documentName: item.documentName,
  documentUrl: item.documentUrl,
  documents: documents.map(serializeDocument),
  revision: item.revision,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

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

const serializePackage = async (row: Awaited<ReturnType<typeof getPackageBase>>) => {
  if (!row) return null;
  const [items, revisions] = await Promise.all([
    db.select().from(submittalItemsTable)
      .where(and(
        eq(submittalItemsTable.packageId, row.package.id),
        eq(submittalItemsTable.tenantId, row.package.tenantId),
        eq(submittalItemsTable.environmentId, row.package.environmentId),
      ))
      .orderBy(submittalItemsTable.itemNumber),
    db.select().from(submittalRevisionsTable)
      .where(and(
        eq(submittalRevisionsTable.packageId, row.package.id),
        eq(submittalRevisionsTable.tenantId, row.package.tenantId),
        eq(submittalRevisionsTable.environmentId, row.package.environmentId),
      ))
      .orderBy(desc(submittalRevisionsTable.revision)),
  ]);
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
    createdAt: row.package.createdAt,
    updatedAt: row.package.updatedAt,
  };
};

const getPackageForMutation = async (req: TenantRequest, submittalId: number) => {
  const row = await getPackageBase(req, submittalId);
  return row?.package;
};

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
  res.status(201).json(await serializePackage(await getPackageBase(req, created.id)));
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
  res.json(await serializePackage(row));
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
  res.json(await serializePackage(await getPackageBase(req, params.data.submittalId)));
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
    const [updated] = await db.update(submittalDocumentsTable).set({
      status: "uploaded",
      uploadedAt: new Date(),
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

export default router;