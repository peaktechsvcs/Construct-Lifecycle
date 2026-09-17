import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  bidsTable,
  businessCustomersTable,
  db,
  estimatesTable,
  membershipsTable,
  platformAuditEventsTable,
  proposalsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateProposalBody,
  DeleteProposalParams,
  GetProposalParams,
  ListProposalsQueryParams,
  UpdateProposalBody,
  UpdateProposalParams,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import { resolveBusinessCustomer } from "../lib/business-customer";

const router: IRouter = Router();
const stages = ["draft", "internal_review", "ready", "sent", "viewed", "accepted", "declined", "expired"] as const;
const integrationKinds = ["document", "crm", "accounting", "e_signature", "other"] as const;
const integrationStatuses = ["manual", "pending", "synced", "error"] as const;

type ProposalRow = {
  proposal: typeof proposalsTable.$inferSelect;
  customerName: string;
  estimateNumber: string | null;
  bidNumber: string | null;
  ownerUserId: number | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
};

const serializeProposal = ({ proposal, customerName, estimateNumber, bidNumber, ownerUserId, ownerEmail, ownerDisplayName }: ProposalRow) => ({
  id: proposal.id,
  environmentId: proposal.environmentId,
  proposalNumber: proposal.proposalNumber,
  businessCustomerId: proposal.businessCustomerId,
  customerName,
  estimateId: proposal.estimateId,
  estimateNumber,
  bidId: proposal.bidId,
  bidNumber,
  name: proposal.name,
  description: proposal.description,
  stage: proposal.stage,
  proposalValue: Number(proposal.proposalValue),
  validUntil: proposal.validUntil,
  recipientName: proposal.recipientName,
  recipientEmail: proposal.recipientEmail,
  ownerUserId,
  owner: ownerUserId === null ? null : {
    userId: ownerUserId,
    email: ownerEmail,
    displayName: ownerDisplayName,
  },
  integrationProviderKey: proposal.integrationProviderKey,
  integrationKind: proposal.integrationKind,
  integrationStatus: proposal.integrationStatus,
  externalReference: proposal.externalReference,
  sentAt: proposal.sentAt,
  respondedAt: proposal.respondedAt,
  createdAt: proposal.createdAt,
  updatedAt: proposal.updatedAt,
});

const getProposalInContext = async (req: TenantRequest, proposalId: number) => {
  const [row] = await db
    .select({
      proposal: proposalsTable,
      customerName: businessCustomersTable.companyName,
      estimateNumber: estimatesTable.estimateNumber,
      bidNumber: bidsTable.bidNumber,
      ownerUserId: usersTable.id,
      ownerEmail: usersTable.email,
      ownerDisplayName: usersTable.displayName,
    })
    .from(proposalsTable)
    .innerJoin(businessCustomersTable, eq(proposalsTable.businessCustomerId, businessCustomersTable.id))
    .leftJoin(estimatesTable, and(
      eq(proposalsTable.estimateId, estimatesTable.id),
      eq(estimatesTable.tenantId, req.tenantId!),
      eq(estimatesTable.environmentId, req.environmentId!),
    ))
    .leftJoin(bidsTable, and(
      eq(proposalsTable.bidId, bidsTable.id),
      eq(bidsTable.tenantId, req.tenantId!),
      eq(bidsTable.environmentId, req.environmentId!),
    ))
    .leftJoin(usersTable, eq(proposalsTable.ownerUserId, usersTable.id))
    .where(and(
      eq(proposalsTable.id, proposalId),
      eq(proposalsTable.tenantId, req.tenantId!),
      eq(proposalsTable.environmentId, req.environmentId!),
    ))
    .limit(1);
  return row;
};

const validateOwner = async (req: TenantRequest, ownerUserId: number | null | undefined) => {
  if (ownerUserId === undefined || ownerUserId === null) return true;
  const [membership] = await db.select({ userId: membershipsTable.userId }).from(membershipsTable).where(and(
    eq(membershipsTable.tenantId, req.tenantId!),
    eq(membershipsTable.userId, ownerUserId),
  )).limit(1);
  return Boolean(membership);
};

const validateRelationships = async (
  req: TenantRequest,
  businessCustomerId: number,
  estimateId: number | null | undefined,
  bidId: number | null | undefined,
) => {
  const [customer] = await db.select({ id: businessCustomersTable.id }).from(businessCustomersTable).where(and(
    eq(businessCustomersTable.id, businessCustomerId),
    eq(businessCustomersTable.tenantId, req.tenantId!),
    eq(businessCustomersTable.environmentId, req.environmentId!),
    eq(businessCustomersTable.status, "active"),
  )).limit(1);
  if (!customer) return "Active business customer not found in this environment";

  if (estimateId !== undefined && estimateId !== null) {
    const [estimate] = await db.select({ id: estimatesTable.id, businessCustomerId: estimatesTable.businessCustomerId })
      .from(estimatesTable).where(and(
        eq(estimatesTable.id, estimateId),
        eq(estimatesTable.tenantId, req.tenantId!),
        eq(estimatesTable.environmentId, req.environmentId!),
      )).limit(1);
    if (!estimate) return "Estimate not found in this environment";
    if (estimate.businessCustomerId !== businessCustomerId) return "Proposal estimate must belong to the selected business customer";
  }

  if (bidId !== undefined && bidId !== null) {
    const [bid] = await db.select({ id: bidsTable.id, businessCustomerId: bidsTable.businessCustomerId })
      .from(bidsTable).where(and(
        eq(bidsTable.id, bidId),
        eq(bidsTable.tenantId, req.tenantId!),
        eq(bidsTable.environmentId, req.environmentId!),
      )).limit(1);
    if (!bid) return "Bid not found in this environment";
    if (bid.businessCustomerId !== businessCustomerId) return "Proposal bid must belong to the selected business customer";
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
  if (status !== "manual" && !input.integrationProviderKey?.trim()) return "An integration provider is required when proposal integration is active";
  if (status === "synced" && !input.externalReference?.trim()) return "A synced proposal requires an external reference";
  return null;
};

const dateString = (value: Date | string | null | undefined) => value instanceof Date ? value.toISOString().slice(0, 10) : value ?? null;
const responseTime = (stage: string, existing: Date | null) => stage === "accepted" || stage === "declined" ? existing ?? new Date() : existing;

router.get("/proposals", async (req: TenantRequest, res) => {
  const parsed = ListProposalsQueryParams.safeParse({
    search: req.query.search,
    stage: req.query.stage,
    ownerUserId: req.query.ownerUserId,
    integrationStatus: req.query.integrationStatus,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid proposal filters" });
    return;
  }
  const conditions = [
    eq(proposalsTable.tenantId, req.tenantId!),
    eq(proposalsTable.environmentId, req.environmentId!),
  ];
  if (parsed.data.stage) conditions.push(eq(proposalsTable.stage, parsed.data.stage));
  if (parsed.data.ownerUserId) conditions.push(eq(proposalsTable.ownerUserId, parsed.data.ownerUserId));
  if (parsed.data.integrationStatus) conditions.push(eq(proposalsTable.integrationStatus, parsed.data.integrationStatus));
  if (parsed.data.search) {
    const term = `%${parsed.data.search}%`;
    const searchCondition = or(
      ilike(proposalsTable.proposalNumber, term),
      ilike(proposalsTable.name, term),
      ilike(businessCustomersTable.companyName, term),
      ilike(proposalsTable.recipientName, term),
      ilike(proposalsTable.recipientEmail, term),
      ilike(proposalsTable.externalReference, term),
      ilike(estimatesTable.estimateNumber, term),
      ilike(bidsTable.bidNumber, term),
    );
    if (searchCondition) conditions.push(searchCondition);
  }
  const rows = await db.select({
    proposal: proposalsTable,
    customerName: businessCustomersTable.companyName,
    estimateNumber: estimatesTable.estimateNumber,
    bidNumber: bidsTable.bidNumber,
    ownerUserId: usersTable.id,
    ownerEmail: usersTable.email,
    ownerDisplayName: usersTable.displayName,
  }).from(proposalsTable)
    .innerJoin(businessCustomersTable, eq(proposalsTable.businessCustomerId, businessCustomersTable.id))
    .leftJoin(estimatesTable, and(
      eq(proposalsTable.estimateId, estimatesTable.id),
      eq(estimatesTable.tenantId, req.tenantId!),
      eq(estimatesTable.environmentId, req.environmentId!),
    ))
    .leftJoin(bidsTable, and(
      eq(proposalsTable.bidId, bidsTable.id),
      eq(bidsTable.tenantId, req.tenantId!),
      eq(bidsTable.environmentId, req.environmentId!),
    ))
    .leftJoin(usersTable, eq(proposalsTable.ownerUserId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(proposalsTable.updatedAt))
    .limit(200);
  res.json(rows.map(serializeProposal));
});

router.post("/proposals", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateProposalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid proposal details", details: parsed.error.issues });
    return;
  }
  if (!(await validateOwner(req, parsed.data.ownerUserId))) {
    res.status(400).json({ error: "Proposal owner must be a member of this workspace" });
    return;
  }
  const integrationError = validateIntegration(parsed.data);
  if (integrationError) {
    res.status(400).json({ error: integrationError });
    return;
  }
  if (parsed.data.newCustomer && (parsed.data.estimateId || parsed.data.bidId)) {
    res.status(400).json({ error: "A new customer cannot be linked to existing pipeline records" });
    return;
  }
  const customer = await resolveBusinessCustomer(req, parsed.data);
  if ("status" in customer) {
    res.status(customer.status).json({ error: customer.error, ...(customer.existingCustomerId ? { existingCustomerId: customer.existingCustomerId } : {}) });
    return;
  }
  const relationshipError = await validateRelationships(req, customer.customerId, parsed.data.estimateId, parsed.data.bidId);
  if (relationshipError) {
    res.status(400).json({ error: relationshipError });
    return;
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(proposalsTable)
    .where(and(eq(proposalsTable.tenantId, req.tenantId!), eq(proposalsTable.environmentId, req.environmentId!)));
  const proposalNumber = `PROP-${new Date().getFullYear()}-${String(Number(count) + 1).padStart(3, "0")}`;
  const stage = parsed.data.stage ?? stages[0];
  const [created] = await db.insert(proposalsTable).values({
    proposalNumber,
    businessCustomerId: customer.customerId,
    estimateId: parsed.data.estimateId ?? null,
    bidId: parsed.data.bidId ?? null,
    name: parsed.data.name.trim(),
    description: parsed.data.description?.trim() || null,
    stage,
    proposalValue: String(parsed.data.proposalValue ?? 0),
    validUntil: dateString(parsed.data.validUntil),
    recipientName: parsed.data.recipientName?.trim() || null,
    recipientEmail: parsed.data.recipientEmail?.trim().toLowerCase() || null,
    ownerUserId: parsed.data.ownerUserId ?? null,
    integrationProviderKey: parsed.data.integrationProviderKey?.trim() || null,
    integrationKind: parsed.data.integrationKind ?? null,
    integrationStatus: parsed.data.integrationStatus ?? "manual",
    externalReference: parsed.data.externalReference?.trim() || null,
    sentAt: stage === "sent" || stage === "viewed" || stage === "accepted" || stage === "declined" ? new Date() : null,
    respondedAt: stage === "accepted" || stage === "declined" ? new Date() : null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId: req.tenantId!,
    action: "proposal_created",
    details: JSON.stringify({ proposalId: created.id, environmentId: req.environmentId }),
  });
  const row = await getProposalInContext(req, created.id);
  res.status(201).json(serializeProposal(row!));
});

router.get("/proposals/:proposalId", async (req: TenantRequest, res) => {
  const parsed = GetProposalParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid proposal id" });
    return;
  }
  const row = await getProposalInContext(req, parsed.data.proposalId);
  if (!row) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  res.json(serializeProposal(row));
});

router.patch("/proposals/:proposalId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateProposalParams.safeParse(req.params);
  const parsed = UpdateProposalBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid proposal update" });
    return;
  }
  const existing = await getProposalInContext(req, params.data.proposalId);
  if (!existing) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  const targetCustomerId = parsed.data.businessCustomerId ?? existing.proposal.businessCustomerId;
  const targetEstimateId = parsed.data.estimateId === undefined ? existing.proposal.estimateId : parsed.data.estimateId;
  const targetBidId = parsed.data.bidId === undefined ? existing.proposal.bidId : parsed.data.bidId;
  const relationshipError = await validateRelationships(req, targetCustomerId, targetEstimateId, targetBidId);
  if (relationshipError) {
    res.status(400).json({ error: relationshipError });
    return;
  }
  if (!(await validateOwner(req, parsed.data.ownerUserId))) {
    res.status(400).json({ error: "Proposal owner must be a member of this workspace" });
    return;
  }
  const integrationError = validateIntegration({
    integrationProviderKey: parsed.data.integrationProviderKey === undefined ? existing.proposal.integrationProviderKey : parsed.data.integrationProviderKey,
    integrationKind: parsed.data.integrationKind === undefined ? existing.proposal.integrationKind : parsed.data.integrationKind,
    integrationStatus: parsed.data.integrationStatus ?? existing.proposal.integrationStatus,
    externalReference: parsed.data.externalReference === undefined ? existing.proposal.externalReference : parsed.data.externalReference,
  });
  if (integrationError) {
    res.status(400).json({ error: integrationError });
    return;
  }
  const stage = parsed.data.stage ?? existing.proposal.stage;
  const [updated] = await db.update(proposalsTable).set({
    ...(parsed.data.businessCustomerId !== undefined && { businessCustomerId: parsed.data.businessCustomerId }),
    ...(parsed.data.estimateId !== undefined && { estimateId: parsed.data.estimateId }),
    ...(parsed.data.bidId !== undefined && { bidId: parsed.data.bidId }),
    ...(parsed.data.name !== undefined && { name: parsed.data.name.trim() }),
    ...(parsed.data.description !== undefined && { description: parsed.data.description?.trim() || null }),
    ...(parsed.data.stage !== undefined && { stage: parsed.data.stage }),
    ...(parsed.data.proposalValue !== undefined && { proposalValue: String(parsed.data.proposalValue) }),
    ...(parsed.data.validUntil !== undefined && { validUntil: dateString(parsed.data.validUntil) }),
    ...(parsed.data.recipientName !== undefined && { recipientName: parsed.data.recipientName?.trim() || null }),
    ...(parsed.data.recipientEmail !== undefined && { recipientEmail: parsed.data.recipientEmail?.trim().toLowerCase() || null }),
    ...(parsed.data.ownerUserId !== undefined && { ownerUserId: parsed.data.ownerUserId }),
    ...(parsed.data.integrationProviderKey !== undefined && { integrationProviderKey: parsed.data.integrationProviderKey?.trim() || null }),
    ...(parsed.data.integrationKind !== undefined && { integrationKind: parsed.data.integrationKind }),
    ...(parsed.data.integrationStatus !== undefined && { integrationStatus: parsed.data.integrationStatus }),
    ...(parsed.data.externalReference !== undefined && { externalReference: parsed.data.externalReference?.trim() || null }),
    ...(stage === "sent" && !existing.proposal.sentAt && { sentAt: new Date() }),
    ...(stage === "viewed" && !existing.proposal.sentAt && { sentAt: new Date() }),
    ...(stage === "accepted" || stage === "declined" ? { sentAt: existing.proposal.sentAt ?? new Date(), respondedAt: responseTime(stage, existing.proposal.respondedAt) } : {}),
    updatedAt: new Date(),
  }).where(and(
    eq(proposalsTable.id, params.data.proposalId),
    eq(proposalsTable.tenantId, req.tenantId!),
    eq(proposalsTable.environmentId, req.environmentId!),
  )).returning();
  const row = await getProposalInContext(req, updated.id);
  res.json(serializeProposal(row!));
});

router.delete("/proposals/:proposalId", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const parsed = DeleteProposalParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid proposal id" });
    return;
  }
  const deleted = await db.delete(proposalsTable).where(and(
    eq(proposalsTable.id, parsed.data.proposalId),
    eq(proposalsTable.tenantId, req.tenantId!),
    eq(proposalsTable.environmentId, req.environmentId!),
  )).returning({ id: proposalsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }
  res.status(204).send();
});

export default router;