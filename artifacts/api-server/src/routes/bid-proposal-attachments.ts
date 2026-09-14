import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  bidProposalAttachmentsTable,
  bidsTable,
  db,
  platformAuditEventsTable,
  proposalsTable,
} from "@workspace/db";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import { z } from "zod";

const router: IRouter = Router();
const purposes = ["qualification", "scope_inclusion", "assumption", "exclusion", "alternate", "substitution_request", "requested_product_data", "other"] as const;
const conversionStatuses = ["open", "accepted", "rejected", "converted"] as const;

const attachmentBody = z.object({
  purpose: z.enum(purposes).optional(),
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(5000).optional(),
  documentName: z.string().trim().max(255).optional(),
  documentUrl: z.string().trim().max(2000).url().optional(),
  integrationProviderKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/).optional(),
  externalReference: z.string().trim().max(240).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  conversionStatus: z.enum(conversionStatuses).optional(),
});

const attachmentUpdate = attachmentBody.partial().extend({
  description: z.string().trim().max(5000).nullish(),
  documentName: z.string().trim().max(255).nullish(),
  documentUrl: z.string().trim().max(2000).url().nullish(),
  integrationProviderKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/).nullish(),
  externalReference: z.string().trim().max(240).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  conversionStatus: z.enum(conversionStatuses).optional(),
});

const parseId = (value: unknown) => {
  const id = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
};

const serialize = (row: typeof bidProposalAttachmentsTable.$inferSelect) => ({
  id: row.id,
  bidId: row.bidId,
  proposalId: row.proposalId,
  purpose: row.purpose,
  title: row.title,
  description: row.description,
  documentName: row.documentName,
  documentUrl: row.documentUrl,
  integrationProviderKey: row.integrationProviderKey,
  externalReference: row.externalReference,
  metadata: row.metadata ? JSON.parse(row.metadata) : {},
  conversionStatus: row.conversionStatus,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const parentExists = async (req: TenantRequest, kind: "bid" | "proposal", id: number) => {
  const [row] = kind === "bid"
    ? await db.select({ id: bidsTable.id }).from(bidsTable).where(and(
      eq(bidsTable.id, id),
      eq(bidsTable.tenantId, req.tenantId!),
      eq(bidsTable.environmentId, req.environmentId!),
    ))
    : await db.select({ id: proposalsTable.id }).from(proposalsTable).where(and(
      eq(proposalsTable.id, id),
      eq(proposalsTable.tenantId, req.tenantId!),
      eq(proposalsTable.environmentId, req.environmentId!),
    ));
  return Boolean(row);
};

const listForParent = async (req: TenantRequest, kind: "bid" | "proposal", id: number) =>
  db.select().from(bidProposalAttachmentsTable).where(and(
    kind === "bid"
      ? eq(bidProposalAttachmentsTable.bidId, id)
      : eq(bidProposalAttachmentsTable.proposalId, id),
    eq(bidProposalAttachmentsTable.tenantId, req.tenantId!),
    eq(bidProposalAttachmentsTable.environmentId, req.environmentId!),
  )).orderBy(desc(bidProposalAttachmentsTable.updatedAt));

const registerRoutes = (kind: "bid" | "proposal", path: string) => {
  router.get(`/${path}/:parentId/attachments`, async (req: TenantRequest, res) => {
    const parentId = parseId(req.params.parentId);
    if (!parentId) {
      res.status(400).json({ error: `Invalid ${kind} id` });
      return;
    }
    if (!(await parentExists(req, kind, parentId))) {
      res.status(404).json({ error: `${kind === "bid" ? "Bid" : "Proposal"} not found` });
      return;
    }
    res.json((await listForParent(req, kind, parentId)).map(serialize));
  });

  router.post(`/${path}/:parentId/attachments`, requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
    const parentId = parseId(req.params.parentId);
    const parsed = attachmentBody.safeParse(req.body);
    if (!parentId || !parsed.success) {
      res.status(400).json({ error: "Invalid bid-stage attachment details", details: parsed.success ? undefined : parsed.error.issues });
      return;
    }
    if (!(await parentExists(req, kind, parentId))) {
      res.status(404).json({ error: `${kind === "bid" ? "Bid" : "Proposal"} not found` });
      return;
    }
    const [created] = await db.insert(bidProposalAttachmentsTable).values({
      bidId: kind === "bid" ? parentId : null,
      proposalId: kind === "proposal" ? parentId : null,
      purpose: parsed.data.purpose ?? "other",
      title: parsed.data.title,
      description: parsed.data.description || null,
      documentName: parsed.data.documentName || null,
      documentUrl: parsed.data.documentUrl || null,
      integrationProviderKey: parsed.data.integrationProviderKey || null,
      externalReference: parsed.data.externalReference || null,
      metadata: parsed.data.metadata ? JSON.stringify(parsed.data.metadata) : null,
      conversionStatus: parsed.data.conversionStatus ?? "open",
      createdByUserId: req.localUserId!,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    }).returning();
    await db.insert(platformAuditEventsTable).values({
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      action: "bid_stage_attachment_created",
      details: JSON.stringify({ attachmentId: created.id, bidId: created.bidId, proposalId: created.proposalId, environmentId: req.environmentId }),
    });
    res.status(201).json(serialize(created));
  });
};

registerRoutes("bid", "bids");
registerRoutes("proposal", "proposals");

router.patch("/bid-proposal-attachments/:attachmentId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const attachmentId = parseId(req.params.attachmentId);
  const parsed = attachmentUpdate.safeParse(req.body);
  if (!attachmentId || !parsed.success) {
    res.status(400).json({ error: "Invalid bid-stage attachment update" });
    return;
  }
  const [existing] = await db.select().from(bidProposalAttachmentsTable).where(and(
    eq(bidProposalAttachmentsTable.id, attachmentId),
    eq(bidProposalAttachmentsTable.tenantId, req.tenantId!),
    eq(bidProposalAttachmentsTable.environmentId, req.environmentId!),
  ));
  if (!existing) {
    res.status(404).json({ error: "Bid-stage attachment not found" });
    return;
  }
  const [updated] = await db.update(bidProposalAttachmentsTable).set({
    ...(parsed.data.purpose !== undefined ? { purpose: parsed.data.purpose } : {}),
    ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    ...(parsed.data.description !== undefined ? { description: parsed.data.description || null } : {}),
    ...(parsed.data.documentName !== undefined ? { documentName: parsed.data.documentName || null } : {}),
    ...(parsed.data.documentUrl !== undefined ? { documentUrl: parsed.data.documentUrl || null } : {}),
    ...(parsed.data.integrationProviderKey !== undefined ? { integrationProviderKey: parsed.data.integrationProviderKey || null } : {}),
    ...(parsed.data.externalReference !== undefined ? { externalReference: parsed.data.externalReference || null } : {}),
    ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata ? JSON.stringify(parsed.data.metadata) : null } : {}),
    ...(parsed.data.conversionStatus !== undefined ? { conversionStatus: parsed.data.conversionStatus } : {}),
    updatedAt: new Date(),
  }).where(and(
    eq(bidProposalAttachmentsTable.id, attachmentId),
    eq(bidProposalAttachmentsTable.tenantId, req.tenantId!),
    eq(bidProposalAttachmentsTable.environmentId, req.environmentId!),
  )).returning();
  res.json(serialize(updated));
});

router.delete("/bid-proposal-attachments/:attachmentId", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const attachmentId = parseId(req.params.attachmentId);
  if (!attachmentId) {
    res.status(400).json({ error: "Invalid bid-stage attachment id" });
    return;
  }
  const deleted = await db.delete(bidProposalAttachmentsTable).where(and(
    eq(bidProposalAttachmentsTable.id, attachmentId),
    eq(bidProposalAttachmentsTable.tenantId, req.tenantId!),
    eq(bidProposalAttachmentsTable.environmentId, req.environmentId!),
  )).returning({ id: bidProposalAttachmentsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Bid-stage attachment not found" });
    return;
  }
  res.status(204).send();
});

export default router;