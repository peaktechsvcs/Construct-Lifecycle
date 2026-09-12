import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  businessCustomersTable,
  db,
  membershipsTable,
  opportunitiesTable,
  platformAuditEventsTable,
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