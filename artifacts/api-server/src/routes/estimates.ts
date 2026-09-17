import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  bidsTable,
  businessCustomersTable,
  db,
  estimatesTable,
  membershipsTable,
  platformAuditEventsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateEstimateBody,
  DeleteEstimateParams,
  GetEstimateParams,
  ListEstimatesQueryParams,
  UpdateEstimateBody,
  UpdateEstimateParams,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import { resolveBusinessCustomer, type DatabaseExecutor } from "../lib/business-customer";

const router: IRouter = Router();
const stages = ["draft", "takeoff", "estimating", "review", "approved", "rejected"] as const;
const integrationKinds = ["takeoff_estimating", "accounting", "pricing", "other"] as const;
const integrationStatuses = ["manual", "pending", "synced", "error"] as const;

type EstimateRow = {
  estimate: typeof estimatesTable.$inferSelect;
  customerName: string;
  bidNumber: string | null;
  ownerUserId: number | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
};

const serializeEstimate = ({ estimate, customerName, bidNumber, ownerUserId, ownerEmail, ownerDisplayName }: EstimateRow) => ({
  id: estimate.id,
  environmentId: estimate.environmentId,
  estimateNumber: estimate.estimateNumber,
  businessCustomerId: estimate.businessCustomerId,
  customerName,
  bidId: estimate.bidId,
  bidNumber,
  name: estimate.name,
  description: estimate.description,
  stage: estimate.stage,
  laborValue: Number(estimate.laborValue),
  materialValue: Number(estimate.materialValue),
  subcontractValue: Number(estimate.subcontractValue),
  otherValue: Number(estimate.otherValue),
  contingencyValue: Number(estimate.contingencyValue),
  totalValue: Number(estimate.totalValue),
  dueDate: estimate.dueDate,
  ownerUserId,
  owner: ownerUserId === null ? null : {
    userId: ownerUserId,
    email: ownerEmail,
    displayName: ownerDisplayName,
  },
  integrationProviderKey: estimate.integrationProviderKey,
  integrationKind: estimate.integrationKind,
  integrationStatus: estimate.integrationStatus,
  externalReference: estimate.externalReference,
  lastSyncedAt: estimate.lastSyncedAt,
  createdAt: estimate.createdAt,
  updatedAt: estimate.updatedAt,
});

const getEstimateInContext = async (req: TenantRequest, estimateId: number) => {
  const [row] = await db
    .select({
      estimate: estimatesTable,
      customerName: businessCustomersTable.companyName,
      bidNumber: bidsTable.bidNumber,
      ownerUserId: usersTable.id,
      ownerEmail: usersTable.email,
      ownerDisplayName: usersTable.displayName,
    })
    .from(estimatesTable)
    .innerJoin(businessCustomersTable, eq(estimatesTable.businessCustomerId, businessCustomersTable.id))
    .leftJoin(bidsTable, and(
      eq(estimatesTable.bidId, bidsTable.id),
      eq(bidsTable.tenantId, req.tenantId!),
      eq(bidsTable.environmentId, req.environmentId!),
    ))
    .leftJoin(usersTable, eq(estimatesTable.ownerUserId, usersTable.id))
    .where(and(
      eq(estimatesTable.id, estimateId),
      eq(estimatesTable.tenantId, req.tenantId!),
      eq(estimatesTable.environmentId, req.environmentId!),
    ))
    .limit(1);
  return row;
};

const validateOwner = async (req: TenantRequest, ownerUserId: number | null | undefined) => {
  if (ownerUserId === undefined || ownerUserId === null) return true;
  const [membership] = await db
    .select({ userId: membershipsTable.userId })
    .from(membershipsTable)
    .where(and(
      eq(membershipsTable.tenantId, req.tenantId!),
      eq(membershipsTable.userId, ownerUserId),
    ))
    .limit(1);
  return Boolean(membership);
};

const validateRelationships = async (
  req: TenantRequest,
  businessCustomerId: number,
  bidId: number | null | undefined,
  executor: DatabaseExecutor = db,
) => {
  const [customer] = await executor
    .select({ id: businessCustomersTable.id })
    .from(businessCustomersTable)
    .where(and(
      eq(businessCustomersTable.id, businessCustomerId),
      eq(businessCustomersTable.tenantId, req.tenantId!),
      eq(businessCustomersTable.environmentId, req.environmentId!),
      eq(businessCustomersTable.status, "active"),
    ))
    .limit(1);
  if (!customer) return "Active business customer not found in this environment";

  if (bidId !== undefined && bidId !== null) {
    const [bid] = await executor
      .select({ id: bidsTable.id, businessCustomerId: bidsTable.businessCustomerId })
      .from(bidsTable)
      .where(and(
        eq(bidsTable.id, bidId),
        eq(bidsTable.tenantId, req.tenantId!),
        eq(bidsTable.environmentId, req.environmentId!),
      ))
      .limit(1);
    if (!bid) return "Bid not found in this environment";
    if (bid.businessCustomerId !== businessCustomerId) {
      return "Estimate bid must belong to the selected business customer";
    }
  }
  return null;
};

const validateIntegration = (input: {
  integrationProviderKey?: string | null;
  integrationKind?: string | null;
  integrationStatus?: string;
  externalReference?: string | null;
}) => {
  const status = input.integrationStatus ?? "manual";
  if (!integrationStatuses.includes(status as typeof integrationStatuses[number])) return "Invalid integration status";
  if (input.integrationKind && !integrationKinds.includes(input.integrationKind as typeof integrationKinds[number])) return "Invalid integration kind";
  if (status !== "manual" && !input.integrationProviderKey?.trim()) {
    return "An integration provider is required when estimate integration is active";
  }
  if (status === "synced" && !input.externalReference?.trim()) {
    return "A synced estimate requires an external reference";
  }
  return null;
};

const totalValue = (values: number[]) => values.reduce((sum, value) => sum + value, 0).toFixed(2);
const numericValue = (value: number | undefined, current: string) => value === undefined ? Number(current) : value;
const dateString = (value: Date | string | null | undefined) => value instanceof Date ? value.toISOString().slice(0, 10) : value ?? null;

router.get("/estimates", async (req: TenantRequest, res) => {
  const parsed = ListEstimatesQueryParams.safeParse({
    search: req.query.search,
    stage: req.query.stage,
    ownerUserId: req.query.ownerUserId,
    integrationStatus: req.query.integrationStatus,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid estimate filters" });
    return;
  }

  const conditions = [
    eq(estimatesTable.tenantId, req.tenantId!),
    eq(estimatesTable.environmentId, req.environmentId!),
  ];
  if (parsed.data.stage) conditions.push(eq(estimatesTable.stage, parsed.data.stage));
  if (parsed.data.ownerUserId) conditions.push(eq(estimatesTable.ownerUserId, parsed.data.ownerUserId));
  if (parsed.data.integrationStatus) conditions.push(eq(estimatesTable.integrationStatus, parsed.data.integrationStatus));
  if (parsed.data.search) {
    const term = `%${parsed.data.search}%`;
    const searchCondition = or(
      ilike(estimatesTable.name, term),
      ilike(estimatesTable.estimateNumber, term),
      ilike(businessCustomersTable.companyName, term),
      ilike(estimatesTable.integrationProviderKey, term),
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  const rows = await db
    .select({
      estimate: estimatesTable,
      customerName: businessCustomersTable.companyName,
      bidNumber: bidsTable.bidNumber,
      ownerUserId: usersTable.id,
      ownerEmail: usersTable.email,
      ownerDisplayName: usersTable.displayName,
    })
    .from(estimatesTable)
    .innerJoin(businessCustomersTable, eq(estimatesTable.businessCustomerId, businessCustomersTable.id))
    .leftJoin(bidsTable, and(
      eq(estimatesTable.bidId, bidsTable.id),
      eq(bidsTable.tenantId, req.tenantId!),
      eq(bidsTable.environmentId, req.environmentId!),
    ))
    .leftJoin(usersTable, eq(estimatesTable.ownerUserId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(estimatesTable.updatedAt))
    .limit(200);

  res.json(rows.map(serializeEstimate));
});

router.post("/estimates", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateEstimateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid estimate details", details: parsed.error.issues });
    return;
  }
  if (!(await validateOwner(req, parsed.data.ownerUserId))) {
    res.status(400).json({ error: "Estimate owner must be a member of this workspace" });
    return;
  }
  const integrationError = validateIntegration(parsed.data);
  if (integrationError) {
    res.status(400).json({ error: integrationError });
    return;
  }
  if (parsed.data.newCustomer && parsed.data.bidId) {
    res.status(400).json({ error: "A new customer cannot be linked to an existing bid" });
    return;
  }
  const transactionResult = await db.transaction(async (tx) => {
    const customer = await resolveBusinessCustomer(req, parsed.data, tx);
    if ("status" in customer) return { customer, createdId: null };
    const relationshipError = await validateRelationships(req, customer.customerId, parsed.data.bidId, tx);
    if (relationshipError) return { customer: { status: 400, error: relationshipError }, createdId: null };

    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(estimatesTable)
      .where(and(eq(estimatesTable.tenantId, req.tenantId!), eq(estimatesTable.environmentId, req.environmentId!)));
    const estimateNumber = `EST-${new Date().getFullYear()}-${String(Number(count) + 1).padStart(3, "0")}`;
    const laborValue = parsed.data.laborValue ?? 0;
    const materialValue = parsed.data.materialValue ?? 0;
    const subcontractValue = parsed.data.subcontractValue ?? 0;
    const otherValue = parsed.data.otherValue ?? 0;
    const contingencyValue = parsed.data.contingencyValue ?? 0;
    const [created] = await tx.insert(estimatesTable).values({
      estimateNumber,
      businessCustomerId: customer.customerId,
      bidId: parsed.data.bidId ?? null,
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      stage: parsed.data.stage ?? stages[0],
      laborValue: laborValue.toFixed(2),
      materialValue: materialValue.toFixed(2),
      subcontractValue: subcontractValue.toFixed(2),
      otherValue: otherValue.toFixed(2),
      contingencyValue: contingencyValue.toFixed(2),
      totalValue: totalValue([laborValue, materialValue, subcontractValue, otherValue, contingencyValue]),
      dueDate: dateString(parsed.data.dueDate),
      ownerUserId: parsed.data.ownerUserId ?? null,
      integrationProviderKey: parsed.data.integrationProviderKey?.trim() || null,
      integrationKind: parsed.data.integrationKind ?? null,
      integrationStatus: parsed.data.integrationStatus ?? "manual",
      externalReference: parsed.data.externalReference?.trim() || null,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    }).returning();
    await tx.insert(platformAuditEventsTable).values({
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      action: "estimate_created",
      details: JSON.stringify({ estimateId: created.id, environmentId: req.environmentId }),
    });
    return { customer, createdId: created.id };
  });
  if ("status" in transactionResult.customer) {
    res.status(transactionResult.customer.status).json({
      error: transactionResult.customer.error,
      ...(transactionResult.customer.existingCustomerId ? { existingCustomerId: transactionResult.customer.existingCustomerId } : {}),
    });
    return;
  }
  const createdId = transactionResult.createdId;
  if (createdId === null) throw new Error("Estimate transaction completed without a created record");
  const row = await getEstimateInContext(req, createdId);
  res.status(201).json(serializeEstimate(row!));
});

router.get("/estimates/:estimateId", async (req: TenantRequest, res) => {
  const parsed = GetEstimateParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid estimate id" });
    return;
  }
  const row = await getEstimateInContext(req, parsed.data.estimateId);
  if (!row) {
    res.status(404).json({ error: "Estimate not found" });
    return;
  }
  res.json(serializeEstimate(row));
});

router.patch("/estimates/:estimateId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateEstimateParams.safeParse(req.params);
  const parsed = UpdateEstimateBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid estimate update" });
    return;
  }
  const existing = await getEstimateInContext(req, params.data.estimateId);
  if (!existing) {
    res.status(404).json({ error: "Estimate not found" });
    return;
  }

  const targetCustomerId = parsed.data.businessCustomerId ?? existing.estimate.businessCustomerId;
  const targetBidId = parsed.data.bidId === undefined ? existing.estimate.bidId : parsed.data.bidId;
  const relationshipError = await validateRelationships(req, targetCustomerId, targetBidId);
  if (relationshipError) {
    res.status(400).json({ error: relationshipError });
    return;
  }
  if (!(await validateOwner(req, parsed.data.ownerUserId))) {
    res.status(400).json({ error: "Estimate owner must be a member of this workspace" });
    return;
  }
  const integrationError = validateIntegration({
    integrationProviderKey: parsed.data.integrationProviderKey === undefined ? existing.estimate.integrationProviderKey : parsed.data.integrationProviderKey,
    integrationKind: parsed.data.integrationKind === undefined ? existing.estimate.integrationKind : parsed.data.integrationKind,
    integrationStatus: parsed.data.integrationStatus ?? existing.estimate.integrationStatus,
    externalReference: parsed.data.externalReference === undefined ? existing.estimate.externalReference : parsed.data.externalReference,
  });
  if (integrationError) {
    res.status(400).json({ error: integrationError });
    return;
  }

  const laborValue = numericValue(parsed.data.laborValue, existing.estimate.laborValue);
  const materialValue = numericValue(parsed.data.materialValue, existing.estimate.materialValue);
  const subcontractValue = numericValue(parsed.data.subcontractValue, existing.estimate.subcontractValue);
  const otherValue = numericValue(parsed.data.otherValue, existing.estimate.otherValue);
  const contingencyValue = numericValue(parsed.data.contingencyValue, existing.estimate.contingencyValue);
  const [updated] = await db.update(estimatesTable).set({
    ...(parsed.data.businessCustomerId !== undefined && { businessCustomerId: parsed.data.businessCustomerId }),
    ...(parsed.data.bidId !== undefined && { bidId: parsed.data.bidId }),
    ...(parsed.data.name !== undefined && { name: parsed.data.name.trim() }),
    ...(parsed.data.description !== undefined && { description: parsed.data.description?.trim() || null }),
    ...(parsed.data.stage !== undefined && { stage: parsed.data.stage }),
    ...(parsed.data.laborValue !== undefined && { laborValue: parsed.data.laborValue.toFixed(2) }),
    ...(parsed.data.materialValue !== undefined && { materialValue: parsed.data.materialValue.toFixed(2) }),
    ...(parsed.data.subcontractValue !== undefined && { subcontractValue: parsed.data.subcontractValue.toFixed(2) }),
    ...(parsed.data.otherValue !== undefined && { otherValue: parsed.data.otherValue.toFixed(2) }),
    ...(parsed.data.contingencyValue !== undefined && { contingencyValue: parsed.data.contingencyValue.toFixed(2) }),
    totalValue: totalValue([laborValue, materialValue, subcontractValue, otherValue, contingencyValue]),
    ...(parsed.data.dueDate !== undefined && { dueDate: dateString(parsed.data.dueDate) }),
    ...(parsed.data.ownerUserId !== undefined && { ownerUserId: parsed.data.ownerUserId }),
    ...(parsed.data.integrationProviderKey !== undefined && { integrationProviderKey: parsed.data.integrationProviderKey?.trim() || null }),
    ...(parsed.data.integrationKind !== undefined && { integrationKind: parsed.data.integrationKind }),
    ...(parsed.data.integrationStatus !== undefined && { integrationStatus: parsed.data.integrationStatus }),
    ...(parsed.data.externalReference !== undefined && { externalReference: parsed.data.externalReference?.trim() || null }),
    updatedAt: new Date(),
  }).where(and(
    eq(estimatesTable.id, params.data.estimateId),
    eq(estimatesTable.tenantId, req.tenantId!),
    eq(estimatesTable.environmentId, req.environmentId!),
  )).returning();

  const row = await getEstimateInContext(req, updated.id);
  res.json(serializeEstimate(row!));
});

router.delete("/estimates/:estimateId", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const parsed = DeleteEstimateParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid estimate id" });
    return;
  }
  const deleted = await db.delete(estimatesTable).where(and(
    eq(estimatesTable.id, parsed.data.estimateId),
    eq(estimatesTable.tenantId, req.tenantId!),
    eq(estimatesTable.environmentId, req.environmentId!),
  )).returning({ id: estimatesTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Estimate not found" });
    return;
  }
  res.status(204).send();
});

export default router;