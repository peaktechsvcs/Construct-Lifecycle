import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  bidsTable,
  businessCustomersTable,
  db,
  platformAuditEventsTable,
  projectsTable,
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

const router: IRouter = Router();

const packageStatuses = ["draft", "submitted", "under_review", "approved", "approved_as_noted", "revise_and_resubmit", "rejected", "superseded"] as const;
const originTypes = ["contract", "accepted_substitution", "accepted_alternate", "early_procurement"] as const;
const itemTypes = ["shop_drawing", "product_data", "sample", "mockup", "calculation", "certificate", "warranty", "closeout", "other"] as const;
const itemStatuses = ["pending", "included", "needs_revision", "accepted", "superseded"] as const;

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

const serializeItem = (item: typeof submittalItemsTable.$inferSelect) => ({
  id: item.id,
  packageId: item.packageId,
  itemNumber: item.itemNumber,
  itemType: item.itemType,
  name: item.name,
  description: item.description,
  status: item.status,
  documentName: item.documentName,
  documentUrl: item.documentUrl,
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
    items: items.map(serializeItem),
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
      status: submittalPackagesTable.status,
      dueDate: submittalPackagesTable.dueDate,
      revision: submittalPackagesTable.revision,
      itemCount: sql<number>`count(${submittalItemsTable.id})::int`,
      projectNumber: projectsTable.projectNumber,
      projectName: projectsTable.projectName,
      customerName: projectsTable.customerName,
    })
    .from(submittalPackagesTable)
    .innerJoin(projectsTable, and(
      eq(submittalPackagesTable.projectId, projectsTable.id),
      eq(projectsTable.tenantId, req.tenantId!),
      eq(projectsTable.environmentId, req.environmentId!),
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
    sourceBidId: null,
    sourceBidNumber: null,
    originType: "contract",
    description: null,
    specificationSection: null,
    responsibleParty: null,
    reviewerName: null,
    reviewComments: null,
    submittedAt: null,
    reviewedAt: null,
    items: [],
    revisions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
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