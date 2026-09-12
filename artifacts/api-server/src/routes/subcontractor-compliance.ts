import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import {
  db,
  projectsTable,
  tradePartnersTable,
  tradePartnerComplianceDocumentsTable,
  projectComplianceRequirementsTable,
  subcontractAgreementsTable,
  subcontractScheduleOfValuesTable,
  subcontractChangeOrdersTable,
  subcontractPayApplicationsTable,
  subcontractWaiversTable,
  subcontractCloseoutItemsTable,
  subcontractAuditEventsTable,
} from "@workspace/db";
import {
  CreateTradePartnerBody,
  CreateTradePartnerComplianceDocumentBody,
  CreateTradePartnerComplianceDocumentParams,
  CreateProjectComplianceRequirementBody,
  CreateProjectComplianceRequirementParams,
  CreateSubcontractAgreementBody,
  CreateSubcontractAgreementParams,
  CreateSubcontractChangeOrderBody,
  CreateSubcontractChangeOrderParams,
  CreateSubcontractCloseoutItemBody,
  CreateSubcontractCloseoutItemParams,
  CreateSubcontractPayApplicationBody,
  CreateSubcontractPayApplicationParams,
  CreateSubcontractScheduleOfValueBody,
  CreateSubcontractScheduleOfValueParams,
  CreateSubcontractWaiverBody,
  CreateSubcontractWaiverParams,
  GetSubcontractAgreementParams,
  GetTradePartnerParams,
  ListProjectComplianceRequirementsParams,
  ListSubcontractAgreementsQueryParams,
  ListTradePartnersQueryParams,
  UpdateProjectComplianceRequirementBody,
  UpdateProjectComplianceRequirementParams,
  UpdateTradePartnerBody,
  UpdateTradePartnerComplianceDocumentBody,
  UpdateTradePartnerComplianceDocumentParams,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { getCurrentTenantRole, requireRole } from "../middlewares/rbac";
import {
  calculatePayApplicationAmounts,
  canReviewCompliance,
  evaluateComplianceGate,
  isComplianceDocumentExpired,
} from "../lib/subcontractor-compliance-policy";

const router: IRouter = Router();

const money = (value: string | number | null | undefined) => Number(value ?? 0);
const dateString = (value: Date | string | null | undefined) =>
  value == null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : value;
const scope = (req: TenantRequest, table: { tenantId: any; environmentId: any }) =>
  and(eq(table.tenantId, req.tenantId!), eq(table.environmentId, req.environmentId!));

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

async function audit(req: TenantRequest, entityType: string, entityId: number, action: string, fromStatus?: string | null, toStatus?: string | null, details?: string) {
  await db.insert(subcontractAuditEventsTable).values({
    entityType,
    entityId,
    action,
    fromStatus: fromStatus ?? null,
    toStatus: toStatus ?? null,
    details: details ?? null,
    actorUserId: req.localUserId ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  });
}

async function getPartner(req: TenantRequest, tradePartnerId: number) {
  const [partner] = await db.select().from(tradePartnersTable).where(and(
    eq(tradePartnersTable.id, tradePartnerId),
    scope(req, tradePartnersTable),
  ));
  return partner;
}

async function getProject(req: TenantRequest, projectId: number) {
  const [project] = await db.select().from(projectsTable).where(and(
    eq(projectsTable.id, projectId),
    scope(req, projectsTable),
  ));
  return project;
}

async function getPartnerGates(req: TenantRequest, partner: typeof tradePartnersTable.$inferSelect, projectId?: number) {
  const documents = await db.select().from(tradePartnerComplianceDocumentsTable).where(and(
    scope(req, tradePartnerComplianceDocumentsTable),
    eq(tradePartnerComplianceDocumentsTable.tradePartnerId, partner.id),
  ));
  const requirements = projectId
    ? await db.select().from(projectComplianceRequirementsTable).where(and(
      scope(req, projectComplianceRequirementsTable),
      eq(projectComplianceRequirementsTable.projectId, projectId),
      eq(projectComplianceRequirementsTable.tradePartnerId, partner.id),
    ))
    : [];
  const gate = (gateName: "award" | "mobilization" | "billing" | "closeout") =>
    evaluateComplianceGate({ qualificationStatus: partner.qualificationStatus, documents, requirements, gate: gateName });
  const evaluated = {
    award: gate("award"),
    mobilization: gate("mobilization"),
    billing: gate("billing"),
    closeout: gate("closeout"),
  };
  return {
    award: evaluated.award.allowed,
    mobilization: evaluated.mobilization.allowed,
    billing: evaluated.billing.allowed,
    closeout: evaluated.closeout.allowed,
    blockers: [...new Set(Object.values(evaluated).flatMap((value) => value.blockers))],
  };
}

async function serializePartner(req: TenantRequest, partner: typeof tradePartnersTable.$inferSelect) {
  const documents = await db.select().from(tradePartnerComplianceDocumentsTable).where(and(
    scope(req, tradePartnerComplianceDocumentsTable),
    eq(tradePartnerComplianceDocumentsTable.tradePartnerId, partner.id),
  ));
  const gates = await getPartnerGates(req, partner);
  return {
    id: partner.id,
    companyName: partner.companyName,
    tradeCapabilities: partner.tradeCapabilities,
    serviceAreas: partner.serviceAreas,
    primaryContact: partner.primaryContact,
    email: partner.email,
    phone: partner.phone,
    qualificationStatus: partner.qualificationStatus,
    qualificationReviewedAt: partner.qualificationReviewedAt,
    status: partner.status,
    complianceCounts: {
      total: documents.length,
      approved: documents.filter((document) => document.status === "approved").length,
      pending: documents.filter((document) => ["requested", "submitted"].includes(document.status)).length,
      expired: documents.filter((document) => isComplianceDocumentExpired(document)).length,
    },
    gates,
    createdAt: partner.createdAt,
    updatedAt: partner.updatedAt,
  };
}

function serializeDocument(document: typeof tradePartnerComplianceDocumentsTable.$inferSelect) {
  return {
    id: document.id,
    tradePartnerId: document.tradePartnerId,
    projectId: document.projectId,
    documentType: document.documentType,
    title: document.title,
    documentNumber: document.documentNumber,
    issuer: document.issuer,
    expiresOn: document.expiresOn,
    status: isComplianceDocumentExpired(document) && document.status === "approved" ? "expired" : document.status,
    objectPath: document.objectPath,
    reviewedAt: document.reviewedAt,
    reviewNotes: document.reviewNotes,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function serializeAgreement(agreement: typeof subcontractAgreementsTable.$inferSelect, tradePartnerName: string) {
  return {
    id: agreement.id,
    projectId: agreement.projectId,
    tradePartnerId: agreement.tradePartnerId,
    tradePartnerName,
    agreementNumber: agreement.agreementNumber,
    scope: agreement.scope,
    originalValue: money(agreement.originalValue),
    currentValue: money(agreement.currentValue),
    contractStart: agreement.contractStart,
    contractEnd: agreement.contractEnd,
    paymentTerms: agreement.paymentTerms,
    retainagePercent: money(agreement.retainagePercent),
    approvalStatus: agreement.approvalStatus,
    status: agreement.status,
    createdAt: agreement.createdAt,
    updatedAt: agreement.updatedAt,
  };
}

function serializeScheduleValue(row: typeof subcontractScheduleOfValuesTable.$inferSelect) {
  return { ...row, scheduledValue: money(row.scheduledValue), approvedValue: money(row.approvedValue), billedToDate: money(row.billedToDate), percentComplete: money(row.percentComplete), retentionHeld: money(row.retentionHeld) };
}

function serializeChangeOrder(row: typeof subcontractChangeOrdersTable.$inferSelect) {
  return { ...row, proposedValue: money(row.proposedValue), approvedValue: money(row.approvedValue) };
}

function serializePayApplication(row: typeof subcontractPayApplicationsTable.$inferSelect) {
  return { ...row, grossAmount: money(row.grossAmount), retainageAmount: money(row.retainageAmount), netAmount: money(row.netAmount), storedMaterialsAmount: money(row.storedMaterialsAmount) };
}

router.get("/trade-partners", async (req: TenantRequest, res) => {
  const parsed = ListTradePartnersQueryParams.safeParse({ search: req.query.search, status: req.query.status });
  if (!parsed.success) { res.status(400).json({ error: "Invalid trade partner filters" }); return; }
  const conditions = [scope(req, tradePartnersTable)];
  if (parsed.data.status) conditions.push(eq(tradePartnersTable.status, parsed.data.status));
  if (parsed.data.search) {
    const term = `%${parsed.data.search}%`;
    const search = or(ilike(tradePartnersTable.companyName, term), ilike(tradePartnersTable.primaryContact, term), ilike(tradePartnersTable.email, term));
    if (search) conditions.push(search);
  }
  const partners = await db.select().from(tradePartnersTable).where(and(...conditions)).orderBy(asc(tradePartnersTable.companyName)).limit(200);
  res.json(await Promise.all(partners.map((partner) => serializePartner(req, partner))));
});

router.post("/trade-partners", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateTradePartnerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid trade partner details" }); return; }
  const normalizedName = normalizeName(parsed.data.companyName);
  const [existing] = await db.select({ id: tradePartnersTable.id }).from(tradePartnersTable).where(and(
    scope(req, tradePartnersTable),
    eq(tradePartnersTable.normalizedName, normalizedName),
  ));
  if (existing) { res.status(409).json({ error: "A trade partner with this name already exists" }); return; }
  const [partner] = await db.insert(tradePartnersTable).values({
    companyName: parsed.data.companyName.trim(),
    normalizedName,
    tradeCapabilities: parsed.data.tradeCapabilities ?? [],
    serviceAreas: parsed.data.serviceAreas ?? [],
    primaryContact: parsed.data.primaryContact?.trim() || null,
    email: parsed.data.email?.trim().toLowerCase() || null,
    phone: parsed.data.phone?.trim() || null,
    qualificationStatus: parsed.data.qualificationStatus ?? "pending",
    qualificationNotes: parsed.data.qualificationNotes?.trim() || null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await audit(req, "trade_partner", partner.id, "trade_partner_created", null, partner.qualificationStatus);
  res.status(201).json(await serializePartner(req, partner));
});

router.get("/trade-partners/:tradePartnerId", async (req: TenantRequest, res) => {
  const params = GetTradePartnerParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid trade partner id" }); return; }
  const partner = await getPartner(req, params.data.tradePartnerId);
  if (!partner) { res.status(404).json({ error: "Trade partner not found" }); return; }
  const [documents, requirements, agreements] = await Promise.all([
    db.select().from(tradePartnerComplianceDocumentsTable).where(and(scope(req, tradePartnerComplianceDocumentsTable), eq(tradePartnerComplianceDocumentsTable.tradePartnerId, partner.id))).orderBy(desc(tradePartnerComplianceDocumentsTable.updatedAt)),
    db.select().from(projectComplianceRequirementsTable).where(and(scope(req, projectComplianceRequirementsTable), eq(projectComplianceRequirementsTable.tradePartnerId, partner.id))).orderBy(asc(projectComplianceRequirementsTable.dueDate)),
    db.select().from(subcontractAgreementsTable).where(and(scope(req, subcontractAgreementsTable), eq(subcontractAgreementsTable.tradePartnerId, partner.id))).orderBy(desc(subcontractAgreementsTable.updatedAt)),
  ]);
  res.json({
    partner: await serializePartner(req, partner),
    complianceDocuments: documents.map(serializeDocument),
    requirements,
    agreements: agreements.map((agreement) => serializeAgreement(agreement, partner.companyName)),
  });
});

router.patch("/trade-partners/:tradePartnerId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateTradePartnerBody.safeParse(req.body);
  const path = GetTradePartnerParams.safeParse(req.params);
  if (!params.success || !path.success) { res.status(400).json({ error: "Invalid trade partner update" }); return; }
  const partner = await getPartner(req, path.data.tradePartnerId);
  if (!partner) { res.status(404).json({ error: "Trade partner not found" }); return; }
  const role = await getCurrentTenantRole(req);
  if (params.data.qualificationStatus && !canReviewCompliance(role)) {
    res.status(403).json({ error: "Only customer administrators can review qualifications" });
    return;
  }
  const nextName = params.data.companyName?.trim();
  const [updated] = await db.update(tradePartnersTable).set({
    companyName: nextName,
    normalizedName: nextName ? normalizeName(nextName) : undefined,
    tradeCapabilities: params.data.tradeCapabilities,
    serviceAreas: params.data.serviceAreas,
    primaryContact: params.data.primaryContact === undefined ? undefined : params.data.primaryContact?.trim() || null,
    email: params.data.email === undefined ? undefined : params.data.email?.trim().toLowerCase() || null,
    phone: params.data.phone === undefined ? undefined : params.data.phone?.trim() || null,
    qualificationStatus: params.data.qualificationStatus,
    qualificationNotes: params.data.qualificationNotes === undefined ? undefined : params.data.qualificationNotes?.trim() || null,
    qualificationReviewedAt: params.data.qualificationStatus ? new Date() : undefined,
    qualificationReviewedByUserId: params.data.qualificationStatus ? req.localUserId : undefined,
    status: params.data.status,
    updatedAt: new Date(),
  }).where(and(scope(req, tradePartnersTable), eq(tradePartnersTable.id, partner.id))).returning();
  await audit(req, "trade_partner", updated.id, "trade_partner_updated", partner.qualificationStatus, updated.qualificationStatus);
  res.json(await serializePartner(req, updated));
});

router.post("/trade-partners/:tradePartnerId/compliance-documents", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = CreateTradePartnerComplianceDocumentParams.safeParse(req.params);
  const parsed = CreateTradePartnerComplianceDocumentBody.safeParse(req.body);
  if (!path.success || !parsed.success) { res.status(400).json({ error: "Invalid compliance document" }); return; }
  if (!await getPartner(req, path.data.tradePartnerId)) { res.status(404).json({ error: "Trade partner not found" }); return; }
  if (parsed.data.projectId && !await getProject(req, parsed.data.projectId)) { res.status(400).json({ error: "Project is not in the active environment" }); return; }
  const [document] = await db.insert(tradePartnerComplianceDocumentsTable).values({
    tradePartnerId: path.data.tradePartnerId,
    projectId: parsed.data.projectId ?? null,
    documentType: parsed.data.documentType.trim(),
    title: parsed.data.title.trim(),
    documentNumber: parsed.data.documentNumber?.trim() || null,
    issuer: parsed.data.issuer?.trim() || null,
    expiresOn: dateString(parsed.data.expiresOn),
    status: parsed.data.status ?? "requested",
    objectPath: parsed.data.objectPath ?? null,
    uploadedByUserId: parsed.data.objectPath ? req.localUserId : null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await audit(req, "compliance_document", document.id, "compliance_document_created", null, document.status);
  res.status(201).json(serializeDocument(document));
});

router.patch("/trade-partners/:tradePartnerId/compliance-documents/:documentId", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const path = UpdateTradePartnerComplianceDocumentParams.safeParse(req.params);
  const parsed = UpdateTradePartnerComplianceDocumentBody.safeParse(req.body);
  if (!path.success || !parsed.success) { res.status(400).json({ error: "Invalid compliance document update" }); return; }
  const [previous] = await db.select().from(tradePartnerComplianceDocumentsTable).where(and(
    scope(req, tradePartnerComplianceDocumentsTable),
    eq(tradePartnerComplianceDocumentsTable.id, path.data.documentId),
    eq(tradePartnerComplianceDocumentsTable.tradePartnerId, path.data.tradePartnerId),
  ));
  if (!previous) { res.status(404).json({ error: "Compliance document not found" }); return; }
  const [updated] = await db.update(tradePartnerComplianceDocumentsTable).set({
    status: parsed.data.status,
    documentNumber: parsed.data.documentNumber === undefined ? undefined : parsed.data.documentNumber,
    issuer: parsed.data.issuer === undefined ? undefined : parsed.data.issuer,
    expiresOn: parsed.data.expiresOn === undefined ? undefined : dateString(parsed.data.expiresOn),
    objectPath: parsed.data.objectPath === undefined ? undefined : parsed.data.objectPath,
    reviewNotes: parsed.data.reviewNotes === undefined ? undefined : parsed.data.reviewNotes,
    reviewedAt: parsed.data.status ? new Date() : undefined,
    reviewedByUserId: parsed.data.status ? req.localUserId : undefined,
    updatedAt: new Date(),
  }).where(and(scope(req, tradePartnerComplianceDocumentsTable), eq(tradePartnerComplianceDocumentsTable.id, previous.id))).returning();
  await audit(req, "compliance_document", updated.id, "compliance_document_reviewed", previous.status, updated.status);
  res.json(serializeDocument(updated));
});

router.get("/projects/:projectId/compliance-requirements", async (req: TenantRequest, res) => {
  const params = ListProjectComplianceRequirementsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid project id" }); return; }
  if (!await getProject(req, params.data.projectId)) { res.status(404).json({ error: "Project not found" }); return; }
  const rows = await db.select().from(projectComplianceRequirementsTable).where(and(
    scope(req, projectComplianceRequirementsTable),
    eq(projectComplianceRequirementsTable.projectId, params.data.projectId),
  )).orderBy(asc(projectComplianceRequirementsTable.dueDate));
  res.json(rows);
});

router.post("/projects/:projectId/compliance-requirements", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = CreateProjectComplianceRequirementParams.safeParse(req.params);
  const parsed = CreateProjectComplianceRequirementBody.safeParse(req.body);
  if (!path.success || !parsed.success) { res.status(400).json({ error: "Invalid project compliance requirement" }); return; }
  if (!await getProject(req, path.data.projectId) || !await getPartner(req, parsed.data.tradePartnerId)) { res.status(400).json({ error: "Project or trade partner is not in the active environment" }); return; }
  if (parsed.data.complianceDocumentId) {
    const [document] = await db.select({ id: tradePartnerComplianceDocumentsTable.id }).from(tradePartnerComplianceDocumentsTable).where(and(scope(req, tradePartnerComplianceDocumentsTable), eq(tradePartnerComplianceDocumentsTable.id, parsed.data.complianceDocumentId), eq(tradePartnerComplianceDocumentsTable.tradePartnerId, parsed.data.tradePartnerId)));
    if (!document) { res.status(400).json({ error: "Compliance document is not owned by this trade partner" }); return; }
  }
  const [row] = await db.insert(projectComplianceRequirementsTable).values({
    projectId: path.data.projectId,
    tradePartnerId: parsed.data.tradePartnerId,
    requirementType: parsed.data.requirementType.trim(),
    title: parsed.data.title.trim(),
    status: parsed.data.status ?? "open",
    dueDate: dateString(parsed.data.dueDate),
    blocksAward: parsed.data.blocksAward ?? false,
    blocksMobilization: parsed.data.blocksMobilization ?? false,
    blocksBilling: parsed.data.blocksBilling ?? false,
    blocksCloseout: parsed.data.blocksCloseout ?? false,
    complianceDocumentId: parsed.data.complianceDocumentId ?? null,
    notes: parsed.data.notes?.trim() || null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await audit(req, "compliance_requirement", row.id, "compliance_requirement_created", null, row.status);
  res.status(201).json(row);
});

router.patch("/projects/:projectId/compliance-requirements/:requirementId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = UpdateProjectComplianceRequirementParams.safeParse(req.params);
  const parsed = UpdateProjectComplianceRequirementBody.safeParse(req.body);
  if (!path.success || !parsed.success) { res.status(400).json({ error: "Invalid compliance requirement update" }); return; }
  const [previous] = await db.select().from(projectComplianceRequirementsTable).where(and(scope(req, projectComplianceRequirementsTable), eq(projectComplianceRequirementsTable.id, path.data.requirementId), eq(projectComplianceRequirementsTable.projectId, path.data.projectId)));
  if (!previous) { res.status(404).json({ error: "Compliance requirement not found" }); return; }
  const [row] = await db.update(projectComplianceRequirementsTable).set({
    status: parsed.data.status,
    title: parsed.data.title,
    dueDate: parsed.data.dueDate === undefined ? undefined : dateString(parsed.data.dueDate),
    blocksAward: parsed.data.blocksAward,
    blocksMobilization: parsed.data.blocksMobilization,
    blocksBilling: parsed.data.blocksBilling,
    blocksCloseout: parsed.data.blocksCloseout,
    complianceDocumentId: parsed.data.complianceDocumentId,
    notes: parsed.data.notes === undefined ? undefined : parsed.data.notes,
    updatedAt: new Date(),
  }).where(and(scope(req, projectComplianceRequirementsTable), eq(projectComplianceRequirementsTable.id, previous.id))).returning();
  await audit(req, "compliance_requirement", row.id, "compliance_requirement_updated", previous.status, row.status);
  res.json(row);
});

router.get("/subcontract-agreements", async (req: TenantRequest, res) => {
  const parsed = ListSubcontractAgreementsQueryParams.safeParse({ projectId: req.query.projectId, tradePartnerId: req.query.tradePartnerId });
  if (!parsed.success) { res.status(400).json({ error: "Invalid subcontract filters" }); return; }
  const conditions = [scope(req, subcontractAgreementsTable)];
  if (parsed.data.projectId) conditions.push(eq(subcontractAgreementsTable.projectId, parsed.data.projectId));
  if (parsed.data.tradePartnerId) conditions.push(eq(subcontractAgreementsTable.tradePartnerId, parsed.data.tradePartnerId));
  const rows = await db.select({ agreement: subcontractAgreementsTable, tradePartnerName: tradePartnersTable.companyName })
    .from(subcontractAgreementsTable)
    .innerJoin(tradePartnersTable, and(eq(subcontractAgreementsTable.tradePartnerId, tradePartnersTable.id), scope(req, tradePartnersTable)))
    .where(and(...conditions))
    .orderBy(desc(subcontractAgreementsTable.updatedAt))
    .limit(200);
  res.json(rows.map((row) => serializeAgreement(row.agreement, row.tradePartnerName)));
});

async function getAgreement(req: TenantRequest, agreementId: number) {
  const [row] = await db.select({ agreement: subcontractAgreementsTable, tradePartnerName: tradePartnersTable.companyName })
    .from(subcontractAgreementsTable)
    .innerJoin(tradePartnersTable, and(eq(subcontractAgreementsTable.tradePartnerId, tradePartnersTable.id), scope(req, tradePartnersTable)))
    .where(and(scope(req, subcontractAgreementsTable), eq(subcontractAgreementsTable.id, agreementId)));
  return row;
}

async function getAgreementWithGate(req: TenantRequest, agreementId: number, gate: "award" | "mobilization" | "billing" | "closeout") {
  const row = await getAgreement(req, agreementId);
  if (!row) return { row: null, error: "Subcontract agreement not found" };
  const partner = await getPartner(req, row.agreement.tradePartnerId);
  if (!partner) return { row: null, error: "Trade partner not found" };
  const gates = await getPartnerGates(req, partner, row.agreement.projectId);
  if (!gates[gate]) return { row: null, error: `This action is blocked by compliance: ${gates.blockers.join(", ")}` };
  return { row, error: null };
}

router.post("/projects/:projectId/subcontract-agreements", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = CreateSubcontractAgreementParams.safeParse(req.params);
  const parsed = CreateSubcontractAgreementBody.safeParse(req.body);
  if (!path.success || !parsed.success) { res.status(400).json({ error: "Invalid subcontract agreement" }); return; }
  if (!await getProject(req, path.data.projectId)) { res.status(404).json({ error: "Project not found" }); return; }
  const partner = await getPartner(req, parsed.data.tradePartnerId);
  if (!partner) { res.status(400).json({ error: "Trade partner not found in the active environment" }); return; }
  const gates = await getPartnerGates(req, partner, path.data.projectId);
  if (!gates.award) { res.status(409).json({ error: `Award blocked by compliance: ${gates.blockers.join(", ")}` }); return; }
  const [row] = await db.insert(subcontractAgreementsTable).values({
    projectId: path.data.projectId,
    tradePartnerId: partner.id,
    agreementNumber: parsed.data.agreementNumber.trim(),
    scope: parsed.data.scope.trim(),
    originalValue: String(parsed.data.originalValue),
    currentValue: String(parsed.data.currentValue ?? parsed.data.originalValue),
    contractStart: dateString(parsed.data.contractStart),
    contractEnd: dateString(parsed.data.contractEnd),
    paymentTerms: parsed.data.paymentTerms?.trim() || null,
    retainagePercent: String(parsed.data.retainagePercent ?? 10),
    approvalStatus: parsed.data.approvalStatus ?? "draft",
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await audit(req, "subcontract_agreement", row.id, "subcontract_agreement_created", null, row.approvalStatus);
  res.status(201).json({ ...serializeAgreement(row, partner.companyName), scheduleOfValues: [], changeOrders: [], payApplications: [], closeoutItems: [] });
});

router.get("/subcontract-agreements/:agreementId", async (req: TenantRequest, res) => {
  const path = GetSubcontractAgreementParams.safeParse(req.params);
  if (!path.success) { res.status(400).json({ error: "Invalid subcontract agreement id" }); return; }
  const row = await getAgreement(req, path.data.agreementId);
  if (!row) { res.status(404).json({ error: "Subcontract agreement not found" }); return; }
  const [scheduleOfValues, changeOrders, payApplications, closeoutItems] = await Promise.all([
    db.select().from(subcontractScheduleOfValuesTable).where(and(scope(req, subcontractScheduleOfValuesTable), eq(subcontractScheduleOfValuesTable.agreementId, row.agreement.id))).orderBy(asc(subcontractScheduleOfValuesTable.lineNumber)),
    db.select().from(subcontractChangeOrdersTable).where(and(scope(req, subcontractChangeOrdersTable), eq(subcontractChangeOrdersTable.agreementId, row.agreement.id))).orderBy(desc(subcontractChangeOrdersTable.updatedAt)),
    db.select().from(subcontractPayApplicationsTable).where(and(scope(req, subcontractPayApplicationsTable), eq(subcontractPayApplicationsTable.agreementId, row.agreement.id))).orderBy(desc(subcontractPayApplicationsTable.updatedAt)),
    db.select().from(subcontractCloseoutItemsTable).where(and(scope(req, subcontractCloseoutItemsTable), eq(subcontractCloseoutItemsTable.agreementId, row.agreement.id))).orderBy(asc(subcontractCloseoutItemsTable.dueDate)),
  ]);
  res.json({
    ...serializeAgreement(row.agreement, row.tradePartnerName),
    scheduleOfValues: scheduleOfValues.map(serializeScheduleValue),
    changeOrders: changeOrders.map(serializeChangeOrder),
    payApplications: payApplications.map(serializePayApplication),
    closeoutItems,
  });
});

router.post("/subcontract-agreements/:agreementId/schedule-of-values", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = CreateSubcontractScheduleOfValueParams.safeParse(req.params);
  const parsed = CreateSubcontractScheduleOfValueBody.safeParse(req.body);
  if (!path.success || !parsed.success) { res.status(400).json({ error: "Invalid subcontract schedule-of-values line" }); return; }
  const row = await getAgreement(req, path.data.agreementId);
  if (!row) { res.status(404).json({ error: "Subcontract agreement not found" }); return; }
  const [created] = await db.insert(subcontractScheduleOfValuesTable).values({
    agreementId: row.agreement.id,
    lineNumber: parsed.data.lineNumber,
    description: parsed.data.description,
    scheduledValue: String(parsed.data.scheduledValue),
    approvedValue: String(parsed.data.approvedValue ?? 0),
    billedToDate: String(parsed.data.billedToDate ?? 0),
    percentComplete: String(parsed.data.percentComplete ?? 0),
    retentionHeld: String(parsed.data.retentionHeld ?? 0),
    status: parsed.data.status ?? "draft",
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await audit(req, "subcontract_schedule_of_values", created.id, "subcontract_sov_line_created");
  res.status(201).json(serializeScheduleValue(created));
});

router.post("/subcontract-agreements/:agreementId/change-orders", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = CreateSubcontractChangeOrderParams.safeParse(req.params);
  const parsed = CreateSubcontractChangeOrderBody.safeParse(req.body);
  if (!path.success || !parsed.success) { res.status(400).json({ error: "Invalid subcontract change order" }); return; }
  const row = await getAgreement(req, path.data.agreementId);
  if (!row) { res.status(404).json({ error: "Subcontract agreement not found" }); return; }
  const [created] = await db.insert(subcontractChangeOrdersTable).values({
    agreementId: row.agreement.id,
    changeNumber: parsed.data.changeNumber,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    proposedValue: String(parsed.data.proposedValue),
    scheduleImpactDays: parsed.data.scheduleImpactDays ?? 0,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await audit(req, "subcontract_change_order", created.id, "subcontract_change_order_created", null, created.approvalStatus);
  res.status(201).json(serializeChangeOrder(created));
});

router.post("/subcontract-agreements/:agreementId/pay-applications", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = CreateSubcontractPayApplicationParams.safeParse(req.params);
  const parsed = CreateSubcontractPayApplicationBody.safeParse(req.body);
  if (!path.success || !parsed.success) { res.status(400).json({ error: "Invalid subcontract pay application" }); return; }
  const gated = await getAgreementWithGate(req, path.data.agreementId, "billing");
  if (!gated.row) { res.status(409).json({ error: gated.error }); return; }
  const amounts = calculatePayApplicationAmounts(parsed.data.grossAmount, parsed.data.retainageAmount ?? 0);
  const [created] = await db.insert(subcontractPayApplicationsTable).values({
    agreementId: gated.row.agreement.id,
    applicationNumber: parsed.data.applicationNumber,
    periodStart: dateString(parsed.data.periodStart),
    periodEnd: dateString(parsed.data.periodEnd),
    grossAmount: String(amounts.grossAmount),
    retainageAmount: String(amounts.retainageAmount),
    netAmount: String(amounts.netAmount),
    storedMaterialsAmount: String(parsed.data.storedMaterialsAmount ?? 0),
    status: "submitted",
    waiverStatus: "missing",
    submittedByUserId: req.localUserId ?? null,
    submittedAt: new Date(),
    supportingDocumentPaths: parsed.data.supportingDocumentPaths ?? [],
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await audit(req, "subcontract_pay_application", created.id, "subcontract_pay_application_submitted", null, created.status);
  res.status(201).json(serializePayApplication(created));
});

router.post("/subcontract-pay-applications/:applicationId/waivers", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = CreateSubcontractWaiverParams.safeParse(req.params);
  const parsed = CreateSubcontractWaiverBody.safeParse(req.body);
  if (!path.success || !parsed.success) { res.status(400).json({ error: "Invalid waiver" }); return; }
  const [application] = await db.select().from(subcontractPayApplicationsTable).where(and(scope(req, subcontractPayApplicationsTable), eq(subcontractPayApplicationsTable.id, path.data.applicationId)));
  if (!application) { res.status(404).json({ error: "Pay application not found" }); return; }
  const [waiver] = await db.insert(subcontractWaiversTable).values({
    payApplicationId: application.id,
    waiverType: parsed.data.waiverType,
    status: parsed.data.status ?? "submitted",
    objectPath: parsed.data.objectPath ?? null,
    receivedAt: new Date(),
    notes: parsed.data.notes ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).onConflictDoUpdate({
    target: [subcontractWaiversTable.tenantId, subcontractWaiversTable.environmentId, subcontractWaiversTable.payApplicationId, subcontractWaiversTable.waiverType],
    set: { status: parsed.data.status ?? "submitted", objectPath: parsed.data.objectPath ?? null, receivedAt: new Date(), notes: parsed.data.notes ?? null, updatedAt: new Date() },
  }).returning();
  await db.update(subcontractPayApplicationsTable).set({ waiverStatus: parsed.data.waiverType, updatedAt: new Date() }).where(and(scope(req, subcontractPayApplicationsTable), eq(subcontractPayApplicationsTable.id, application.id)));
  await audit(req, "subcontract_waiver", waiver.id, "subcontract_waiver_recorded", null, waiver.status);
  res.status(201).json(waiver);
});

router.post("/subcontract-agreements/:agreementId/closeout-items", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = CreateSubcontractCloseoutItemParams.safeParse(req.params);
  const parsed = CreateSubcontractCloseoutItemBody.safeParse(req.body);
  if (!path.success || !parsed.success) { res.status(400).json({ error: "Invalid subcontract closeout item" }); return; }
  const gated = await getAgreementWithGate(req, path.data.agreementId, "closeout");
  if (!gated.row) { res.status(409).json({ error: gated.error }); return; }
  const [created] = await db.insert(subcontractCloseoutItemsTable).values({
    agreementId: gated.row.agreement.id,
    itemType: parsed.data.itemType,
    title: parsed.data.title,
    dueDate: dateString(parsed.data.dueDate),
    objectPath: parsed.data.objectPath ?? null,
    notes: parsed.data.notes ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await audit(req, "subcontract_closeout_item", created.id, "subcontract_closeout_item_created", null, created.status);
  res.status(201).json(created);
});

export default router;