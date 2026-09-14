import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  bidScopesTable,
  bidsTable,
  businessCustomersTable,
  db,
  estimatesTable,
  membershipsTable,
  opportunityActivitiesTable,
  opportunitiesTable,
  platformAuditEventsTable,
  proposalsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateOpportunityBody,
  DeleteOpportunityParams,
  GetOpportunityParams,
  ListOpportunitiesQueryParams,
  UpdateOpportunityBody,
  UpdateOpportunityParams,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";

const router: IRouter = Router();
const stages = ["new", "qualified", "proposal", "negotiation", "won", "lost"] as const;

type OpportunityRow = {
  opportunity: typeof opportunitiesTable.$inferSelect;
  customerName: string;
  ownerUserId: number | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
};

const serializeOpportunity = ({ opportunity, customerName, ownerUserId, ownerEmail, ownerDisplayName }: OpportunityRow) => ({
  id: opportunity.id,
  environmentId: opportunity.environmentId,
  opportunityNumber: opportunity.opportunityNumber,
  businessCustomerId: opportunity.businessCustomerId,
  customerName,
  name: opportunity.name,
  description: opportunity.description,
  stage: opportunity.stage,
  estimatedValue: Number(opportunity.estimatedValue),
  expectedCloseDate: opportunity.expectedCloseDate,
  ownerUserId,
  owner: ownerUserId === null ? null : {
    userId: ownerUserId,
    email: ownerEmail,
    displayName: ownerDisplayName,
  },
  crmProviderKey: opportunity.crmProviderKey,
  leadSource: opportunity.leadSource,
  contactName: opportunity.contactName,
  contactEmail: opportunity.contactEmail,
  contactPhone: opportunity.contactPhone,
  qualification: opportunity.qualification,
  nextAction: opportunity.nextAction,
  nextActionDate: opportunity.nextActionDate,
  lastContactedAt: opportunity.lastContactedAt,
  crmIntegrationStatus: opportunity.crmIntegrationStatus,
  crmExternalReference: opportunity.crmExternalReference,
  crmLastSyncedAt: opportunity.crmLastSyncedAt,
  createdAt: opportunity.createdAt,
  updatedAt: opportunity.updatedAt,
});

const getOpportunityInContext = async (req: TenantRequest, opportunityId: number) => {
  const [row] = await db
    .select({
      opportunity: opportunitiesTable,
      customerName: businessCustomersTable.companyName,
      ownerUserId: usersTable.id,
      ownerEmail: usersTable.email,
      ownerDisplayName: usersTable.displayName,
    })
    .from(opportunitiesTable)
    .innerJoin(businessCustomersTable, eq(opportunitiesTable.businessCustomerId, businessCustomersTable.id))
    .leftJoin(usersTable, eq(opportunitiesTable.ownerUserId, usersTable.id))
    .where(and(
      eq(opportunitiesTable.id, opportunityId),
      eq(opportunitiesTable.tenantId, req.tenantId!),
      eq(opportunitiesTable.environmentId, req.environmentId!),
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

const validateCustomer = async (req: TenantRequest, customerId: number) => {
  const [customer] = await db
    .select({ id: businessCustomersTable.id })
    .from(businessCustomersTable)
    .where(and(
      eq(businessCustomersTable.id, customerId),
      eq(businessCustomersTable.tenantId, req.tenantId!),
      eq(businessCustomersTable.environmentId, req.environmentId!),
      eq(businessCustomersTable.status, "active"),
    ))
    .limit(1);
  return Boolean(customer);
};

const dateString = (value: Date | null | undefined) => value ? value.toISOString().slice(0, 10) : null;
const activityTypes = ["note", "call", "email", "meeting", "task"] as const;

const serializeOpportunityActivity = (row: {
  activity: typeof opportunityActivitiesTable.$inferSelect;
  actorEmail: string | null;
  actorDisplayName: string | null;
}) => ({
  id: row.activity.id,
  environmentId: row.activity.environmentId,
  opportunityId: row.activity.opportunityId,
  activityType: row.activity.activityType,
  subject: row.activity.subject,
  body: row.activity.body,
  occurredAt: row.activity.occurredAt,
  nextActionDate: row.activity.nextActionDate,
  completed: row.activity.completed,
  createdByUserId: row.activity.createdByUserId,
  actor: row.activity.createdByUserId === null ? null : {
    userId: row.activity.createdByUserId,
    email: row.actorEmail,
    displayName: row.actorDisplayName,
  },
  createdAt: row.activity.createdAt,
  updatedAt: row.activity.updatedAt,
});

router.get("/opportunities", async (req: TenantRequest, res) => {
  const parsed = ListOpportunitiesQueryParams.safeParse({
    search: req.query.search,
    stage: req.query.stage,
    ownerUserId: req.query.ownerUserId,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid opportunity filters" });
    return;
  }

  const conditions = [
    eq(opportunitiesTable.tenantId, req.tenantId!),
    eq(opportunitiesTable.environmentId, req.environmentId!),
  ];
  if (parsed.data.stage) conditions.push(eq(opportunitiesTable.stage, parsed.data.stage));
  if (parsed.data.ownerUserId) conditions.push(eq(opportunitiesTable.ownerUserId, parsed.data.ownerUserId));
  if (parsed.data.search) {
    const term = `%${parsed.data.search}%`;
    const searchCondition = or(
      ilike(opportunitiesTable.name, term),
      ilike(opportunitiesTable.opportunityNumber, term),
      ilike(businessCustomersTable.companyName, term),
      ilike(opportunitiesTable.crmProviderKey, term),
      ilike(opportunitiesTable.crmExternalReference, term),
      ilike(opportunitiesTable.contactName, term),
      ilike(opportunitiesTable.contactEmail, term),
      ilike(opportunitiesTable.leadSource, term),
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  const rows = await db
    .select({
      opportunity: opportunitiesTable,
      customerName: businessCustomersTable.companyName,
      ownerUserId: usersTable.id,
      ownerEmail: usersTable.email,
      ownerDisplayName: usersTable.displayName,
    })
    .from(opportunitiesTable)
    .innerJoin(businessCustomersTable, eq(opportunitiesTable.businessCustomerId, businessCustomersTable.id))
    .leftJoin(usersTable, eq(opportunitiesTable.ownerUserId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(opportunitiesTable.updatedAt))
    .limit(200);

  res.json(rows.map(serializeOpportunity));
});

router.post("/opportunities", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateOpportunityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid opportunity details", details: parsed.error.issues });
    return;
  }
  if (!(await validateCustomer(req, parsed.data.businessCustomerId))) {
    res.status(404).json({ error: "Active business customer not found in this environment" });
    return;
  }
  if (!(await validateOwner(req, parsed.data.ownerUserId))) {
    res.status(400).json({ error: "Opportunity owner must be a member of this workspace" });
    return;
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(opportunitiesTable)
    .where(and(eq(opportunitiesTable.tenantId, req.tenantId!), eq(opportunitiesTable.environmentId, req.environmentId!)));
  const opportunityNumber = `OP-${new Date().getFullYear()}-${String(Number(count) + 1).padStart(3, "0")}`;
  const [created] = await db.insert(opportunitiesTable).values({
    opportunityNumber,
    businessCustomerId: parsed.data.businessCustomerId,
    name: parsed.data.name.trim(),
    description: parsed.data.description?.trim() || null,
    stage: parsed.data.stage ?? stages[0],
    estimatedValue: String(parsed.data.estimatedValue ?? 0),
    expectedCloseDate: dateString(parsed.data.expectedCloseDate),
    ownerUserId: parsed.data.ownerUserId ?? null,
    leadSource: parsed.data.leadSource?.trim() || null,
    contactName: parsed.data.contactName?.trim() || null,
    contactEmail: parsed.data.contactEmail?.trim().toLowerCase() || null,
    contactPhone: parsed.data.contactPhone?.trim() || null,
    qualification: parsed.data.qualification ?? "unqualified",
    nextAction: parsed.data.nextAction?.trim() || null,
    nextActionDate: dateString(parsed.data.nextActionDate),
    lastContactedAt: parsed.data.lastContactedAt ? new Date(parsed.data.lastContactedAt) : null,
    crmProviderKey: parsed.data.crmProviderKey?.trim() || null,
    crmIntegrationStatus: parsed.data.crmIntegrationStatus ?? "manual",
    crmExternalReference: parsed.data.crmExternalReference?.trim() || null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId: req.tenantId!,
    action: "opportunity_created",
    details: JSON.stringify({ opportunityId: created.id, environmentId: req.environmentId }),
  });
  const row = await getOpportunityInContext(req, created.id);
  res.status(201).json(serializeOpportunity(row!));
});

router.get("/opportunities/:opportunityId", async (req: TenantRequest, res) => {
  const parsed = GetOpportunityParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid opportunity id" });
    return;
  }
  const row = await getOpportunityInContext(req, parsed.data.opportunityId);
  if (!row) {
    res.status(404).json({ error: "Opportunity not found" });
    return;
  }
  res.json(serializeOpportunity(row));
});

router.get("/opportunities/:opportunityId/preconstruction", async (req: TenantRequest, res) => {
  const params = GetOpportunityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid opportunity id" });
    return;
  }
  const opportunity = await getOpportunityInContext(req, params.data.opportunityId);
  if (!opportunity) {
    res.status(404).json({ error: "Opportunity not found" });
    return;
  }

  const [bids, activities] = await Promise.all([
    db.select({
      bid: bidsTable,
      scopeCount: sql<number>`count(${bidScopesTable.id})::int`,
      coverageGapCount: sql<number>`count(*) filter (where ${bidScopesTable.takeoffCoverage} in ('none', 'partial') or ${bidScopesTable.estimatingCoverage} in ('none', 'partial'))::int`,
    })
      .from(bidsTable)
      .leftJoin(bidScopesTable, and(
        eq(bidScopesTable.bidId, bidsTable.id),
        eq(bidScopesTable.tenantId, req.tenantId!),
        eq(bidScopesTable.environmentId, req.environmentId!),
      ))
      .where(and(
        eq(bidsTable.opportunityId, params.data.opportunityId),
        eq(bidsTable.tenantId, req.tenantId!),
        eq(bidsTable.environmentId, req.environmentId!),
      ))
      .groupBy(bidsTable.id)
      .orderBy(desc(bidsTable.updatedAt)),
    db.select({
      activity: opportunityActivitiesTable,
      actorEmail: usersTable.email,
      actorDisplayName: usersTable.displayName,
    })
      .from(opportunityActivitiesTable)
      .leftJoin(usersTable, eq(opportunityActivitiesTable.createdByUserId, usersTable.id))
      .where(and(
        eq(opportunityActivitiesTable.opportunityId, params.data.opportunityId),
        eq(opportunityActivitiesTable.tenantId, req.tenantId!),
        eq(opportunityActivitiesTable.environmentId, req.environmentId!),
      ))
      .orderBy(desc(opportunityActivitiesTable.occurredAt))
      .limit(100),
  ]);

  const bidIds = bids.map(({ bid }) => bid.id);
  const estimates = bidIds.length === 0 ? [] : await db.select({ estimate: estimatesTable })
    .from(estimatesTable)
    .where(and(
      eq(estimatesTable.tenantId, req.tenantId!),
      eq(estimatesTable.environmentId, req.environmentId!),
      inArray(estimatesTable.bidId, bidIds),
    ))
    .orderBy(desc(estimatesTable.updatedAt));
  const estimateIds = estimates.map(({ estimate }) => estimate.id);
  const proposalLink = bidIds.length && estimateIds.length
    ? or(inArray(proposalsTable.bidId, bidIds), inArray(proposalsTable.estimateId, estimateIds))
    : bidIds.length
      ? inArray(proposalsTable.bidId, bidIds)
      : estimateIds.length
        ? inArray(proposalsTable.estimateId, estimateIds)
        : undefined;
  const proposals = await db.select({ proposal: proposalsTable })
    .from(proposalsTable)
    .where(and(
      eq(proposalsTable.tenantId, req.tenantId!),
      eq(proposalsTable.environmentId, req.environmentId!),
      proposalLink,
    ))
    .orderBy(desc(proposalsTable.updatedAt));

  const nodes = [
    ...bids.map(({ bid, scopeCount, coverageGapCount }) => ({
      recordType: "bid" as const,
      id: bid.id,
      recordNumber: bid.bidNumber,
      name: bid.name,
      stage: bid.stage,
      value: Number(bid.estimatedValue),
      dueDate: bid.dueDate,
      linkedRecordType: "opportunity" as const,
      linkedRecordId: params.data.opportunityId,
      scopeCount,
      coverageGapCount,
    })),
    ...estimates.map(({ estimate }) => ({
      recordType: "estimate" as const,
      id: estimate.id,
      recordNumber: estimate.estimateNumber,
      name: estimate.name,
      stage: estimate.stage,
      value: Number(estimate.totalValue),
      dueDate: estimate.dueDate,
      linkedRecordType: "bid" as const,
      linkedRecordId: estimate.bidId,
      scopeCount: null,
      coverageGapCount: null,
    })),
    ...proposals.map(({ proposal }) => ({
      recordType: "proposal" as const,
      id: proposal.id,
      recordNumber: proposal.proposalNumber,
      name: proposal.name,
      stage: proposal.stage,
      value: Number(proposal.proposalValue),
      dueDate: proposal.validUntil,
      linkedRecordType: proposal.estimateId ? "estimate" as const : "bid" as const,
      linkedRecordId: proposal.estimateId ?? proposal.bidId,
      scopeCount: null,
      coverageGapCount: null,
    })),
  ];

  res.json({
    opportunity: serializeOpportunity(opportunity),
    nodes,
    activities: activities.map(serializeOpportunityActivity),
    summary: {
      bidCount: bids.length,
      scopeCount: bids.reduce((total, row) => total + Number(row.scopeCount), 0),
      estimateCount: estimates.length,
      proposalCount: proposals.length,
      coverageGapCount: bids.reduce((total, row) => total + Number(row.coverageGapCount), 0),
      openNextActions: activities.filter(({ activity }) => activity.nextActionDate && !activity.completed).length,
    },
  });
});

router.get("/opportunities/:opportunityId/activity", async (req: TenantRequest, res) => {
  const params = GetOpportunityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid opportunity id" });
    return;
  }
  if (!(await getOpportunityInContext(req, params.data.opportunityId))) {
    res.status(404).json({ error: "Opportunity not found" });
    return;
  }
  const rows = await db.select({
    activity: opportunityActivitiesTable,
    actorEmail: usersTable.email,
    actorDisplayName: usersTable.displayName,
  })
    .from(opportunityActivitiesTable)
    .leftJoin(usersTable, eq(opportunityActivitiesTable.createdByUserId, usersTable.id))
    .where(and(
      eq(opportunityActivitiesTable.opportunityId, params.data.opportunityId),
      eq(opportunityActivitiesTable.tenantId, req.tenantId!),
      eq(opportunityActivitiesTable.environmentId, req.environmentId!),
    ))
    .orderBy(desc(opportunityActivitiesTable.occurredAt))
    .limit(100);
  res.json(rows.map(serializeOpportunityActivity));
});

router.post("/opportunities/:opportunityId/activity", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = GetOpportunityParams.safeParse(req.params);
  const body = req.body as {
    activityType?: string;
    subject?: unknown;
    body?: unknown;
    occurredAt?: unknown;
    nextActionDate?: unknown;
  };
  if (!params.success || typeof body.subject !== "string" || !body.subject.trim() || body.subject.length > 240) {
    res.status(400).json({ error: "Activity subject is required and must be 240 characters or fewer" });
    return;
  }
  if (body.activityType && !activityTypes.includes(body.activityType as typeof activityTypes[number])) {
    res.status(400).json({ error: "Invalid activity type" });
    return;
  }
  const opportunity = await getOpportunityInContext(req, params.data.opportunityId);
  if (!opportunity) {
    res.status(404).json({ error: "Opportunity not found" });
    return;
  }
  const occurredAt = body.occurredAt ? new Date(String(body.occurredAt)) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    res.status(400).json({ error: "Invalid activity date" });
    return;
  }
  const nextActionDate = body.nextActionDate === undefined || body.nextActionDate === null || body.nextActionDate === ""
    ? null
    : String(body.nextActionDate);
  if (nextActionDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextActionDate)) {
    res.status(400).json({ error: "Next action date must use YYYY-MM-DD" });
    return;
  }
  const [created] = await db.insert(opportunityActivitiesTable).values({
    opportunityId: params.data.opportunityId,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
    activityType: body.activityType ?? "note",
    subject: body.subject.trim(),
    body: typeof body.body === "string" && body.body.trim() ? body.body.trim() : null,
    occurredAt,
    nextActionDate,
    completed: false,
    createdByUserId: req.localUserId ?? null,
  }).returning();
  await db.update(opportunitiesTable).set({
    ...(created.activityType !== "task" ? { lastContactedAt: occurredAt } : {}),
    ...(nextActionDate ? { nextAction: created.subject, nextActionDate } : {}),
    updatedAt: new Date(),
  }).where(and(
    eq(opportunitiesTable.id, params.data.opportunityId),
    eq(opportunitiesTable.tenantId, req.tenantId!),
    eq(opportunitiesTable.environmentId, req.environmentId!),
  ));
  res.status(201).json(serializeOpportunityActivity({
    activity: created,
    actorEmail: null,
    actorDisplayName: "You",
  }));
});

router.patch("/opportunities/:opportunityId/activity/:activityId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = GetOpportunityParams.safeParse({ opportunityId: req.params.opportunityId });
  const activityId = Number(req.params.activityId);
  if (!params.success || !Number.isInteger(activityId) || activityId < 1) {
    res.status(400).json({ error: "Invalid activity id" });
    return;
  }
  const [existing] = await db.select().from(opportunityActivitiesTable).where(and(
    eq(opportunityActivitiesTable.id, activityId),
    eq(opportunityActivitiesTable.opportunityId, params.data.opportunityId),
    eq(opportunityActivitiesTable.tenantId, req.tenantId!),
    eq(opportunityActivitiesTable.environmentId, req.environmentId!),
  )).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Opportunity activity not found" });
    return;
  }
  const completed = req.body?.completed;
  if (completed !== undefined && typeof completed !== "boolean") {
    res.status(400).json({ error: "Completed must be a boolean" });
    return;
  }
  const [updated] = await db.update(opportunityActivitiesTable).set({
    ...(completed !== undefined ? { completed } : {}),
    updatedAt: new Date(),
  }).where(and(
    eq(opportunityActivitiesTable.id, activityId),
    eq(opportunityActivitiesTable.tenantId, req.tenantId!),
    eq(opportunityActivitiesTable.environmentId, req.environmentId!),
  )).returning();
  res.json(serializeOpportunityActivity({
    activity: updated,
    actorEmail: null,
    actorDisplayName: updated.createdByUserId ? null : "You",
  }));
});

router.patch("/opportunities/:opportunityId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateOpportunityParams.safeParse(req.params);
  const parsed = UpdateOpportunityBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid opportunity update" });
    return;
  }
  const existing = await getOpportunityInContext(req, params.data.opportunityId);
  if (!existing) {
    res.status(404).json({ error: "Opportunity not found" });
    return;
  }
  if (parsed.data.businessCustomerId !== undefined && !(await validateCustomer(req, parsed.data.businessCustomerId))) {
    res.status(404).json({ error: "Active business customer not found in this environment" });
    return;
  }
  if (!(await validateOwner(req, parsed.data.ownerUserId))) {
    res.status(400).json({ error: "Opportunity owner must be a member of this workspace" });
    return;
  }
  await db.update(opportunitiesTable).set({
    ...(parsed.data.businessCustomerId !== undefined ? { businessCustomerId: parsed.data.businessCustomerId } : {}),
    ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
    ...(parsed.data.description !== undefined ? { description: parsed.data.description?.trim() || null } : {}),
    ...(parsed.data.stage !== undefined ? { stage: parsed.data.stage } : {}),
    ...(parsed.data.estimatedValue !== undefined ? { estimatedValue: String(parsed.data.estimatedValue) } : {}),
    ...(parsed.data.expectedCloseDate !== undefined ? { expectedCloseDate: dateString(parsed.data.expectedCloseDate) } : {}),
    ...(parsed.data.ownerUserId !== undefined ? { ownerUserId: parsed.data.ownerUserId } : {}),
    ...(parsed.data.leadSource !== undefined ? { leadSource: parsed.data.leadSource?.trim() || null } : {}),
    ...(parsed.data.contactName !== undefined ? { contactName: parsed.data.contactName?.trim() || null } : {}),
    ...(parsed.data.contactEmail !== undefined ? { contactEmail: parsed.data.contactEmail?.trim().toLowerCase() || null } : {}),
    ...(parsed.data.contactPhone !== undefined ? { contactPhone: parsed.data.contactPhone?.trim() || null } : {}),
    ...(parsed.data.qualification !== undefined ? { qualification: parsed.data.qualification } : {}),
    ...(parsed.data.nextAction !== undefined ? { nextAction: parsed.data.nextAction?.trim() || null } : {}),
    ...(parsed.data.nextActionDate !== undefined ? { nextActionDate: dateString(parsed.data.nextActionDate) } : {}),
    ...(parsed.data.lastContactedAt !== undefined ? { lastContactedAt: parsed.data.lastContactedAt ? new Date(parsed.data.lastContactedAt) : null } : {}),
    ...(parsed.data.crmProviderKey !== undefined ? { crmProviderKey: parsed.data.crmProviderKey?.trim() || null } : {}),
    ...(parsed.data.crmIntegrationStatus !== undefined ? { crmIntegrationStatus: parsed.data.crmIntegrationStatus } : {}),
    ...(parsed.data.crmExternalReference !== undefined ? { crmExternalReference: parsed.data.crmExternalReference?.trim() || null } : {}),
    updatedAt: new Date(),
  }).where(and(
    eq(opportunitiesTable.id, params.data.opportunityId),
    eq(opportunitiesTable.tenantId, req.tenantId!),
    eq(opportunitiesTable.environmentId, req.environmentId!),
  ));
  const row = await getOpportunityInContext(req, params.data.opportunityId);
  res.json(serializeOpportunity(row!));
});

router.delete("/opportunities/:opportunityId", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const params = DeleteOpportunityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid opportunity id" });
    return;
  }
  const deleted = await db.delete(opportunitiesTable).where(and(
    eq(opportunitiesTable.id, params.data.opportunityId),
    eq(opportunitiesTable.tenantId, req.tenantId!),
    eq(opportunitiesTable.environmentId, req.environmentId!),
  )).returning({ id: opportunitiesTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Opportunity not found" });
    return;
  }
  res.status(204).send();
});

export default router;