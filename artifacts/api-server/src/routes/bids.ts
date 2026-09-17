import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  bidScopesTable,
  bidsTable,
  businessCustomersTable,
  db,
  membershipsTable,
  opportunitiesTable,
  platformAuditEventsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateBidBody,
  CreateBidScopeBody,
  CreateBidScopeParams,
  DeleteBidScopeParams,
  DeleteBidParams,
  GetBidParams,
  ListBidScopesParams,
  ListBidsQueryParams,
  UpdateBidScopeBody,
  UpdateBidScopeParams,
  UpdateBidBody,
  UpdateBidParams,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import { resolveBusinessCustomer, type DatabaseExecutor } from "../lib/business-customer";

const router: IRouter = Router();
const stages = ["invited", "qualifying", "takeoff", "estimating", "review", "submitted", "awarded", "lost"] as const;
const coverageModes = ["none", "full", "partial"] as const;
const scopeStatuses = ["draft", "active", "submitted", "awarded", "lost"] as const;

type BidRow = {
  bid: typeof bidsTable.$inferSelect;
  customerName: string;
  opportunityName: string | null;
  ownerUserId: number | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
};

type BidScopeRow = {
  scope: typeof bidScopesTable.$inferSelect;
  ownerUserId: number | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
};

const serializeScope = ({ scope, ownerUserId, ownerEmail, ownerDisplayName }: BidScopeRow) => ({
  id: scope.id,
  bidId: scope.bidId,
  name: scope.name,
  description: scope.description,
  amount: Number(scope.amount),
  ownerUserId,
  owner: ownerUserId === null ? null : {
    userId: ownerUserId,
    email: ownerEmail,
    displayName: ownerDisplayName,
  },
  status: scope.status,
  takeoffProvider: scope.takeoffProvider,
  takeoffCoverage: scope.takeoffCoverage,
  estimatingProvider: scope.estimatingProvider,
  estimatingCoverage: scope.estimatingCoverage,
  createdAt: scope.createdAt,
  updatedAt: scope.updatedAt,
});

const serializeBid = (
  { bid, customerName, opportunityName, ownerUserId, ownerEmail, ownerDisplayName }: BidRow,
  scopeRows: BidScopeRow[] = [],
) => {
  const scopes = scopeRows.map(serializeScope);
  const scopeTotal = scopes.reduce((sum, scope) => sum + scope.amount, 0);
  const scopeCoverageGapCount = scopes.filter((scope) =>
    scope.takeoffCoverage !== "full" || scope.estimatingCoverage !== "full"
  ).length;
  const hasScopes = scopes.length > 0;
  const legacyCoverageGap = bid.takeoffCoverage !== "full" || bid.estimatingCoverage !== "full";
  return {
  id: bid.id,
  environmentId: bid.environmentId,
  bidNumber: bid.bidNumber,
  businessCustomerId: bid.businessCustomerId,
  customerName,
  opportunityId: bid.opportunityId,
  opportunityName,
  name: bid.name,
  description: bid.description,
  stage: bid.stage,
  bidType: bid.bidType,
  scopeMode: bid.scopeMode,
  specialty: bid.specialty,
  estimatedValue: hasScopes ? scopeTotal : Number(bid.estimatedValue),
  dueDate: bid.dueDate,
  ownerUserId,
  owner: ownerUserId === null ? null : {
    userId: ownerUserId,
    email: ownerEmail,
    displayName: ownerDisplayName,
  },
  takeoffProvider: bid.takeoffProvider,
  takeoffCoverage: bid.takeoffCoverage,
  estimatingProvider: bid.estimatingProvider,
  estimatingCoverage: bid.estimatingCoverage,
  scopes,
  scopeCount: scopes.length,
  scopeTotal,
  coverageGapCount: hasScopes ? scopeCoverageGapCount : (legacyCoverageGap ? 1 : 0),
  hasCoverageGap: hasScopes ? scopeCoverageGapCount > 0 : legacyCoverageGap,
  createdAt: bid.createdAt,
  updatedAt: bid.updatedAt,
  };
};

const getBidInContext = async (req: TenantRequest, bidId: number) => {
  const [row] = await db
    .select({
      bid: bidsTable,
      customerName: businessCustomersTable.companyName,
      opportunityName: opportunitiesTable.name,
      ownerUserId: usersTable.id,
      ownerEmail: usersTable.email,
      ownerDisplayName: usersTable.displayName,
    })
    .from(bidsTable)
    .innerJoin(businessCustomersTable, eq(bidsTable.businessCustomerId, businessCustomersTable.id))
    .leftJoin(opportunitiesTable, and(
      eq(bidsTable.opportunityId, opportunitiesTable.id),
      eq(opportunitiesTable.tenantId, req.tenantId!),
      eq(opportunitiesTable.environmentId, req.environmentId!),
    ))
    .leftJoin(usersTable, eq(bidsTable.ownerUserId, usersTable.id))
    .where(and(
      eq(bidsTable.id, bidId),
      eq(bidsTable.tenantId, req.tenantId!),
      eq(bidsTable.environmentId, req.environmentId!),
    ))
    .limit(1);
  return row;
};

const getScopesInContext = async (req: TenantRequest, bidId: number): Promise<BidScopeRow[]> =>
  db.select({
    scope: bidScopesTable,
    ownerUserId: usersTable.id,
    ownerEmail: usersTable.email,
    ownerDisplayName: usersTable.displayName,
  })
    .from(bidScopesTable)
    .leftJoin(usersTable, eq(bidScopesTable.ownerUserId, usersTable.id))
    .where(and(
      eq(bidScopesTable.bidId, bidId),
      eq(bidScopesTable.tenantId, req.tenantId!),
      eq(bidScopesTable.environmentId, req.environmentId!),
    ))
    .orderBy(desc(bidScopesTable.updatedAt));

const getScopesForBids = async (req: TenantRequest, bidIds: number[]) => {
  if (bidIds.length === 0) return new Map<number, BidScopeRow[]>();
  const rows = await db.select({
    scope: bidScopesTable,
    ownerUserId: usersTable.id,
    ownerEmail: usersTable.email,
    ownerDisplayName: usersTable.displayName,
  })
    .from(bidScopesTable)
    .leftJoin(usersTable, eq(bidScopesTable.ownerUserId, usersTable.id))
    .where(and(
      inArray(bidScopesTable.bidId, bidIds),
      eq(bidScopesTable.tenantId, req.tenantId!),
      eq(bidScopesTable.environmentId, req.environmentId!),
    ))
    .orderBy(desc(bidScopesTable.updatedAt));
  const byBid = new Map<number, BidScopeRow[]>();
  for (const row of rows) {
    const scopes = byBid.get(row.scope.bidId) ?? [];
    scopes.push(row);
    byBid.set(row.scope.bidId, scopes);
  }
  return byBid;
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
  opportunityId: number | null | undefined,
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

  if (opportunityId !== undefined && opportunityId !== null) {
    const [opportunity] = await executor
      .select({ id: opportunitiesTable.id, businessCustomerId: opportunitiesTable.businessCustomerId })
      .from(opportunitiesTable)
      .where(and(
        eq(opportunitiesTable.id, opportunityId),
        eq(opportunitiesTable.tenantId, req.tenantId!),
        eq(opportunitiesTable.environmentId, req.environmentId!),
      ))
      .limit(1);
    if (!opportunity) return "Opportunity not found in this environment";
    if (opportunity.businessCustomerId !== businessCustomerId) {
      return "Bid opportunity must belong to the selected business customer";
    }
  }
  return null;
};

const validateBidConfiguration = (input: {
  bidType?: string;
  specialty?: string | null;
  takeoffProvider?: string | null;
  takeoffCoverage?: string;
  estimatingProvider?: string | null;
  estimatingCoverage?: string;
}) => {
  if (input.bidType === "specialty" && !input.specialty?.trim()) {
    return "Specialty bids require a specialty";
  }
  if (input.takeoffCoverage && !coverageModes.includes(input.takeoffCoverage as typeof coverageModes[number])) {
    return "Invalid takeoff coverage";
  }
  if (input.estimatingCoverage && !coverageModes.includes(input.estimatingCoverage as typeof coverageModes[number])) {
    return "Invalid estimating coverage";
  }
  if (input.takeoffCoverage && input.takeoffCoverage !== "none" && !input.takeoffProvider?.trim()) {
    return "Takeoff provider is required when takeoff coverage is enabled";
  }
  if (input.estimatingCoverage && input.estimatingCoverage !== "none" && !input.estimatingProvider?.trim()) {
    return "Estimating provider is required when estimating coverage is enabled";
  }
  return null;
};

const validateScopeConfiguration = (input: {
  name?: string;
  status?: string;
  takeoffProvider?: string | null;
  takeoffCoverage?: string;
  estimatingProvider?: string | null;
  estimatingCoverage?: string;
}) => {
  if (input.name !== undefined && !input.name.trim()) return "Scope name is required";
  if (input.status && !scopeStatuses.includes(input.status as typeof scopeStatuses[number])) return "Invalid scope status";
  if (input.takeoffCoverage && !coverageModes.includes(input.takeoffCoverage as typeof coverageModes[number])) {
    return "Invalid takeoff coverage";
  }
  if (input.estimatingCoverage && !coverageModes.includes(input.estimatingCoverage as typeof coverageModes[number])) {
    return "Invalid estimating coverage";
  }
  if (input.takeoffCoverage && input.takeoffCoverage !== "none" && !input.takeoffProvider?.trim()) {
    return "Takeoff provider is required when takeoff coverage is enabled";
  }
  if (input.estimatingCoverage && input.estimatingCoverage !== "none" && !input.estimatingProvider?.trim()) {
    return "Estimating provider is required when estimating coverage is enabled";
  }
  return null;
};

const dateString = (value: Date | null | undefined) => value ? value.toISOString().slice(0, 10) : null;

router.get("/bids", async (req: TenantRequest, res) => {
  const parsed = ListBidsQueryParams.safeParse({
    search: req.query.search,
    stage: req.query.stage,
    ownerUserId: req.query.ownerUserId,
    bidType: req.query.bidType,
    scopeMode: req.query.scopeMode,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bid filters" });
    return;
  }

  const conditions = [
    eq(bidsTable.tenantId, req.tenantId!),
    eq(bidsTable.environmentId, req.environmentId!),
  ];
  if (parsed.data.stage) conditions.push(eq(bidsTable.stage, parsed.data.stage));
  if (parsed.data.ownerUserId) conditions.push(eq(bidsTable.ownerUserId, parsed.data.ownerUserId));
  if (parsed.data.bidType) conditions.push(eq(bidsTable.bidType, parsed.data.bidType));
  if (parsed.data.scopeMode) conditions.push(eq(bidsTable.scopeMode, parsed.data.scopeMode));
  if (parsed.data.search) {
    const term = `%${parsed.data.search}%`;
    const searchCondition = or(
      ilike(bidsTable.name, term),
      ilike(bidsTable.bidNumber, term),
      ilike(businessCustomersTable.companyName, term),
      ilike(bidsTable.specialty, term),
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  const rows = await db
    .select({
      bid: bidsTable,
      customerName: businessCustomersTable.companyName,
      opportunityName: opportunitiesTable.name,
      ownerUserId: usersTable.id,
      ownerEmail: usersTable.email,
      ownerDisplayName: usersTable.displayName,
    })
    .from(bidsTable)
    .innerJoin(businessCustomersTable, eq(bidsTable.businessCustomerId, businessCustomersTable.id))
    .leftJoin(opportunitiesTable, and(
      eq(bidsTable.opportunityId, opportunitiesTable.id),
      eq(opportunitiesTable.tenantId, req.tenantId!),
      eq(opportunitiesTable.environmentId, req.environmentId!),
    ))
    .leftJoin(usersTable, eq(bidsTable.ownerUserId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(bidsTable.updatedAt))
    .limit(200);

  const scopesByBid = await getScopesForBids(req, rows.map((row) => row.bid.id));
  res.json(rows.map((row) => serializeBid(row, scopesByBid.get(row.bid.id) ?? [])));
});

router.post("/bids", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateBidBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bid details", details: parsed.error.issues });
    return;
  }
  if (!(await validateOwner(req, parsed.data.ownerUserId))) {
    res.status(400).json({ error: "Bid owner must be a member of this workspace" });
    return;
  }
  const configurationError = validateBidConfiguration(parsed.data);
  if (configurationError) {
    res.status(400).json({ error: configurationError });
    return;
  }
  if (parsed.data.newCustomer && parsed.data.opportunityId) {
    res.status(400).json({ error: "A new customer cannot be linked to an existing opportunity" });
    return;
  }
  const transactionResult = await db.transaction(async (tx) => {
    const customer = await resolveBusinessCustomer(req, parsed.data, tx);
    if ("status" in customer) return { customer, createdId: null };
    const relationshipError = await validateRelationships(req, customer.customerId, parsed.data.opportunityId, tx);
    if (relationshipError) return { customer: { status: 400, error: relationshipError }, createdId: null };

    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(bidsTable)
      .where(and(eq(bidsTable.tenantId, req.tenantId!), eq(bidsTable.environmentId, req.environmentId!)));
    const bidNumber = `BID-${new Date().getFullYear()}-${String(Number(count) + 1).padStart(3, "0")}`;
    const [created] = await tx.insert(bidsTable).values({
      bidNumber,
      businessCustomerId: customer.customerId,
      opportunityId: parsed.data.opportunityId ?? null,
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      stage: parsed.data.stage ?? stages[0],
      bidType: parsed.data.bidType ?? "general",
      scopeMode: parsed.data.scopeMode ?? "full",
      specialty: parsed.data.specialty?.trim() || null,
      estimatedValue: String(parsed.data.estimatedValue ?? 0),
      dueDate: dateString(parsed.data.dueDate),
      ownerUserId: parsed.data.ownerUserId ?? null,
      takeoffProvider: parsed.data.takeoffProvider?.trim() || null,
      takeoffCoverage: parsed.data.takeoffCoverage ?? "none",
      estimatingProvider: parsed.data.estimatingProvider?.trim() || null,
      estimatingCoverage: parsed.data.estimatingCoverage ?? "none",
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    }).returning();
    await tx.insert(platformAuditEventsTable).values({
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      action: "bid_created",
      details: JSON.stringify({ bidId: created.id, environmentId: req.environmentId }),
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
  if (createdId === null) throw new Error("Bid transaction completed without a created record");
  const row = await getBidInContext(req, createdId);
  res.status(201).json(serializeBid(row!, []));
});

router.get("/bids/:bidId", async (req: TenantRequest, res) => {
  const parsed = GetBidParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bid id" });
    return;
  }
  const row = await getBidInContext(req, parsed.data.bidId);
  if (!row) {
    res.status(404).json({ error: "Bid not found" });
    return;
  }
  res.json(serializeBid(row, await getScopesInContext(req, row.bid.id)));
});

router.patch("/bids/:bidId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateBidParams.safeParse(req.params);
  const parsed = UpdateBidBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid bid update" });
    return;
  }
  const existing = await getBidInContext(req, params.data.bidId);
  if (!existing) {
    res.status(404).json({ error: "Bid not found" });
    return;
  }

  const targetCustomerId = parsed.data.businessCustomerId ?? existing.bid.businessCustomerId;
  const targetOpportunityId = parsed.data.opportunityId === undefined ? existing.bid.opportunityId : parsed.data.opportunityId;
  const relationshipError = await validateRelationships(req, targetCustomerId, targetOpportunityId);
  if (relationshipError) {
    res.status(400).json({ error: relationshipError });
    return;
  }
  if (!(await validateOwner(req, parsed.data.ownerUserId))) {
    res.status(400).json({ error: "Bid owner must be a member of this workspace" });
    return;
  }
  const configurationError = validateBidConfiguration({
    bidType: parsed.data.bidType ?? existing.bid.bidType,
    specialty: parsed.data.specialty === undefined ? existing.bid.specialty : parsed.data.specialty,
    takeoffProvider: parsed.data.takeoffProvider === undefined ? existing.bid.takeoffProvider : parsed.data.takeoffProvider,
    takeoffCoverage: parsed.data.takeoffCoverage ?? existing.bid.takeoffCoverage,
    estimatingProvider: parsed.data.estimatingProvider === undefined ? existing.bid.estimatingProvider : parsed.data.estimatingProvider,
    estimatingCoverage: parsed.data.estimatingCoverage ?? existing.bid.estimatingCoverage,
  });
  if (configurationError) {
    res.status(400).json({ error: configurationError });
    return;
  }

  await db.update(bidsTable).set({
    ...(parsed.data.businessCustomerId !== undefined ? { businessCustomerId: parsed.data.businessCustomerId } : {}),
    ...(parsed.data.opportunityId !== undefined ? { opportunityId: parsed.data.opportunityId } : {}),
    ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.description !== undefined ? { description: parsed.data.description?.trim() || null } : {}),
    ...(parsed.data.stage !== undefined ? { stage: parsed.data.stage } : {}),
    ...(parsed.data.bidType !== undefined ? { bidType: parsed.data.bidType } : {}),
    ...(parsed.data.scopeMode !== undefined ? { scopeMode: parsed.data.scopeMode } : {}),
    ...(parsed.data.specialty !== undefined ? { specialty: parsed.data.specialty?.trim() || null } : {}),
    ...(parsed.data.estimatedValue !== undefined ? { estimatedValue: String(parsed.data.estimatedValue) } : {}),
    ...(parsed.data.dueDate !== undefined ? { dueDate: dateString(parsed.data.dueDate) } : {}),
    ...(parsed.data.ownerUserId !== undefined ? { ownerUserId: parsed.data.ownerUserId } : {}),
    ...(parsed.data.takeoffProvider !== undefined ? { takeoffProvider: parsed.data.takeoffProvider?.trim() || null } : {}),
    ...(parsed.data.takeoffCoverage !== undefined ? { takeoffCoverage: parsed.data.takeoffCoverage } : {}),
    ...(parsed.data.estimatingProvider !== undefined ? { estimatingProvider: parsed.data.estimatingProvider?.trim() || null } : {}),
    ...(parsed.data.estimatingCoverage !== undefined ? { estimatingCoverage: parsed.data.estimatingCoverage } : {}),
    updatedAt: new Date(),
  }).where(and(
    eq(bidsTable.id, params.data.bidId),
    eq(bidsTable.tenantId, req.tenantId!),
    eq(bidsTable.environmentId, req.environmentId!),
  ));
  const row = await getBidInContext(req, params.data.bidId);
  res.json(serializeBid(row!, await getScopesInContext(req, params.data.bidId)));
});

router.delete("/bids/:bidId", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const params = DeleteBidParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid bid id" });
    return;
  }
  const deleted = await db.delete(bidsTable).where(and(
    eq(bidsTable.id, params.data.bidId),
    eq(bidsTable.tenantId, req.tenantId!),
    eq(bidsTable.environmentId, req.environmentId!),
  )).returning({ id: bidsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Bid not found" });
    return;
  }
  res.status(204).send();
});

router.get("/bids/:bidId/scopes", async (req: TenantRequest, res) => {
  const params = ListBidScopesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid bid id" });
    return;
  }
  const bid = await getBidInContext(req, params.data.bidId);
  if (!bid) {
    res.status(404).json({ error: "Bid not found" });
    return;
  }
  res.json((await getScopesInContext(req, params.data.bidId)).map(serializeScope));
});

router.post("/bids/:bidId/scopes", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = CreateBidScopeParams.safeParse(req.params);
  const parsed = CreateBidScopeBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid bid scope details" });
    return;
  }
  const bid = await getBidInContext(req, params.data.bidId);
  if (!bid) {
    res.status(404).json({ error: "Bid not found" });
    return;
  }
  if (bid.bid.bidType !== "specialty") {
    res.status(400).json({ error: "Only specialty bids can contain specialty scopes" });
    return;
  }
  if (!(await validateOwner(req, parsed.data.ownerUserId))) {
    res.status(400).json({ error: "Scope owner must be a member of this workspace" });
    return;
  }
  const configurationError = validateScopeConfiguration(parsed.data);
  if (configurationError) {
    res.status(400).json({ error: configurationError });
    return;
  }
  const [created] = await db.insert(bidScopesTable).values({
    bidId: params.data.bidId,
    name: parsed.data.name.trim(),
    description: parsed.data.description?.trim() || null,
    amount: String(parsed.data.amount ?? 0),
    ownerUserId: parsed.data.ownerUserId ?? null,
    status: parsed.data.status ?? "draft",
    takeoffProvider: parsed.data.takeoffProvider?.trim() || null,
    takeoffCoverage: parsed.data.takeoffCoverage ?? "none",
    estimatingProvider: parsed.data.estimatingProvider?.trim() || null,
    estimatingCoverage: parsed.data.estimatingCoverage ?? "none",
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId: req.tenantId!,
    action: "bid_scope_created",
    details: JSON.stringify({ bidId: params.data.bidId, scopeId: created.id, environmentId: req.environmentId }),
  });
  const [scope] = await db.select({
    scope: bidScopesTable,
    ownerUserId: usersTable.id,
    ownerEmail: usersTable.email,
    ownerDisplayName: usersTable.displayName,
  }).from(bidScopesTable).leftJoin(usersTable, eq(bidScopesTable.ownerUserId, usersTable.id)).where(eq(bidScopesTable.id, created.id));
  res.status(201).json(serializeScope(scope!));
});

router.patch("/bids/:bidId/scopes/:scopeId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateBidScopeParams.safeParse(req.params);
  const parsed = UpdateBidScopeBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid bid scope update" });
    return;
  }
  const bid = await getBidInContext(req, params.data.bidId);
  if (!bid) {
    res.status(404).json({ error: "Bid not found" });
    return;
  }
  const [existing] = await db.select().from(bidScopesTable).where(and(
    eq(bidScopesTable.id, params.data.scopeId),
    eq(bidScopesTable.bidId, params.data.bidId),
    eq(bidScopesTable.tenantId, req.tenantId!),
    eq(bidScopesTable.environmentId, req.environmentId!),
  ));
  if (!existing) {
    res.status(404).json({ error: "Bid scope not found" });
    return;
  }
  if (!(await validateOwner(req, parsed.data.ownerUserId))) {
    res.status(400).json({ error: "Scope owner must be a member of this workspace" });
    return;
  }
  const configurationError = validateScopeConfiguration({
    name: parsed.data.name,
    status: parsed.data.status,
    takeoffProvider: parsed.data.takeoffProvider === undefined ? existing.takeoffProvider : parsed.data.takeoffProvider,
    takeoffCoverage: parsed.data.takeoffCoverage ?? existing.takeoffCoverage,
    estimatingProvider: parsed.data.estimatingProvider === undefined ? existing.estimatingProvider : parsed.data.estimatingProvider,
    estimatingCoverage: parsed.data.estimatingCoverage ?? existing.estimatingCoverage,
  });
  if (configurationError) {
    res.status(400).json({ error: configurationError });
    return;
  }
  await db.update(bidScopesTable).set({
    ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.description !== undefined ? { description: parsed.data.description?.trim() || null } : {}),
    ...(parsed.data.amount !== undefined ? { amount: String(parsed.data.amount) } : {}),
    ...(parsed.data.ownerUserId !== undefined ? { ownerUserId: parsed.data.ownerUserId } : {}),
    ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    ...(parsed.data.takeoffProvider !== undefined ? { takeoffProvider: parsed.data.takeoffProvider?.trim() || null } : {}),
    ...(parsed.data.takeoffCoverage !== undefined ? { takeoffCoverage: parsed.data.takeoffCoverage } : {}),
    ...(parsed.data.estimatingProvider !== undefined ? { estimatingProvider: parsed.data.estimatingProvider?.trim() || null } : {}),
    ...(parsed.data.estimatingCoverage !== undefined ? { estimatingCoverage: parsed.data.estimatingCoverage } : {}),
    updatedAt: new Date(),
  }).where(and(
    eq(bidScopesTable.id, params.data.scopeId),
    eq(bidScopesTable.bidId, params.data.bidId),
    eq(bidScopesTable.tenantId, req.tenantId!),
    eq(bidScopesTable.environmentId, req.environmentId!),
  ));
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId: req.tenantId!,
    action: "bid_scope_updated",
    details: JSON.stringify({ bidId: params.data.bidId, scopeId: params.data.scopeId, environmentId: req.environmentId }),
  });
  const [scope] = await db.select({
    scope: bidScopesTable,
    ownerUserId: usersTable.id,
    ownerEmail: usersTable.email,
    ownerDisplayName: usersTable.displayName,
  }).from(bidScopesTable).leftJoin(usersTable, eq(bidScopesTable.ownerUserId, usersTable.id)).where(and(
    eq(bidScopesTable.id, params.data.scopeId),
    eq(bidScopesTable.bidId, params.data.bidId),
    eq(bidScopesTable.tenantId, req.tenantId!),
    eq(bidScopesTable.environmentId, req.environmentId!),
  ));
  res.json(serializeScope(scope!));
});

router.delete("/bids/:bidId/scopes/:scopeId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = DeleteBidScopeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid bid scope id" });
    return;
  }
  const deleted = await db.delete(bidScopesTable).where(and(
    eq(bidScopesTable.id, params.data.scopeId),
    eq(bidScopesTable.bidId, params.data.bidId),
    eq(bidScopesTable.tenantId, req.tenantId!),
    eq(bidScopesTable.environmentId, req.environmentId!),
  )).returning({ id: bidScopesTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Bid scope not found" });
    return;
  }
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId: req.tenantId!,
    action: "bid_scope_deleted",
    details: JSON.stringify({ bidId: params.data.bidId, scopeId: params.data.scopeId, environmentId: req.environmentId }),
  });
  res.status(204).send();
});

export default router;