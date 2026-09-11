import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, platformAuditEventsTable } from "@workspace/db";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import {
  clonePublishedWorkflowToDraft,
  ensurePublishedWorkflow,
  getDraftWorkflow,
  getPublishedWorkflow,
  publishDraftWorkflow,
  replaceDraftWorkflow,
  type WorkflowConfig,
} from "../lib/workflow";

const router: IRouter = Router();

const workflowStateInput = z.object({
  stableKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,62}$/),
  displayName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  normalizedCategory: z.string().trim().min(1).max(64),
  displayOrder: z.number().int().min(0).max(1000),
  active: z.boolean().optional(),
  terminal: z.boolean().optional(),
  allowManualEnter: z.boolean().optional(),
  allowManualLeave: z.boolean().optional(),
  defaultStatusKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,62}$/).nullable().optional(),
  requiredFields: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
});

const workflowStatusInput = z.object({
  stableKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,62}$/),
  displayName: z.string().trim().min(1).max(120),
  stateKeys: z.array(z.string().trim().regex(/^[a-z][a-z0-9_]{1,62}$/)).max(100).optional(),
  displayOrder: z.number().int().min(0).max(1000),
  active: z.boolean().optional(),
  required: z.boolean().optional(),
});

const workflowTransitionInput = z.object({
  fromStateKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,62}$/),
  toStateKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,62}$/),
  active: z.boolean().optional(),
  requiresConfirmation: z.boolean().optional(),
  allowedRoles: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  requiredFields: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  warningFields: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
});

const workflowConfigInput = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  states: z.array(workflowStateInput).min(1).max(100),
  statuses: z.array(workflowStatusInput).max(200),
  transitions: z.array(workflowTransitionInput).max(500),
});

function serialize(config: WorkflowConfig | null) {
  if (!config) return null;
  return config;
}

async function readConfig(req: TenantRequest) {
  const published = await ensurePublishedWorkflow(req.tenantId!, req.environmentId!, req.localUserId);
  const draft = await getDraftWorkflow(req.tenantId!, req.environmentId!);
  return { published: serialize(published), draft: serialize(draft) };
}

router.get("/workflow/config", async (req: TenantRequest, res) => {
  res.json(await readConfig(req));
});

router.post("/workflow/draft", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const draft = await clonePublishedWorkflowToDraft(req.tenantId!, req.environmentId!, req.localUserId!);
  res.status(201).json({ draft: serialize(draft) });
});

router.put("/workflow/draft", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const parsed = workflowConfigInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid workflow configuration", details: parsed.error.issues });
    return;
  }
  const draft = await clonePublishedWorkflowToDraft(req.tenantId!, req.environmentId!, req.localUserId!);
  if (!draft) {
    res.status(409).json({ error: "Workflow draft could not be initialized" });
    return;
  }
  const result = await replaceDraftWorkflow(draft.template.id, parsed.data);
  if (result.errors.length) {
    res.status(422).json({ error: "Workflow configuration failed validation", errors: result.errors });
    return;
  }
  res.json(await readConfig(req));
});

router.post("/workflow/draft/publish", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const draft = await getDraftWorkflow(req.tenantId!, req.environmentId!);
  if (!draft) {
    res.status(404).json({ error: "No workflow draft exists" });
    return;
  }
  const result = await publishDraftWorkflow(draft.template.id, req.localUserId!);
  if (result.errors.length) {
    res.status(422).json({ error: "Workflow configuration failed validation", errors: result.errors });
    return;
  }
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId: req.tenantId!,
    action: "workflow_published",
    details: JSON.stringify({
      environmentId: req.environmentId,
      workflowTemplateId: draft.template.id,
      version: draft.template.version,
    }),
  });
  res.json(await readConfig(req));
});

export default router;