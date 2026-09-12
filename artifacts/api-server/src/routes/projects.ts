import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  businessCustomersTable,
  activityTable,
  db,
  followUpsTable,
  platformAuditEventsTable,
  projectsTable,
} from "@workspace/db";
import {
  CreateFollowUpBody,
  CreateProjectBody,
  ListProjectsQueryParams,
  UpdateFollowUpBody,
  UpdateFollowUpParams,
  UpdateProjectBody,
  UpdateProjectParams,
  GetDashboardDrilldownQueryParams,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { getCurrentTenantRole, requireRole } from "../middlewares/rbac";
import { normalizeCustomerName } from "./customers";
import { ensurePublishedWorkflow, validateProjectTransition } from "../lib/workflow";

const router: IRouter = Router();

const toProject = (row: typeof projectsTable.$inferSelect) => ({
  ...row,
  contractValue: Number(row.contractValue),
  invoicedAmount: Number(row.invoicedAmount),
  receivedAmount: Number(row.receivedAmount),
});

const toDateString = (value: Date | undefined) =>
  value ? value.toISOString().slice(0, 10) : undefined;

const ACTIVE_STAGES = ["award", "contract", "procure", "deliver", "financial", "closeout"] as const;
const PIPELINE_STAGES = ["opportunity", "bid"] as const;
const dateToday = () => new Date().toISOString().slice(0, 10);
const daysSince = (date: Date) => Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
const projectContribution = (project: typeof projectsTable.$inferSelect) => ({
  id: project.id, projectNumber: project.projectNumber, customerName: project.customerName,
  projectName: project.projectName, owner: project.owner, stage: project.stage,
  contractValue: Number(project.contractValue), receivedAmount: Number(project.receivedAmount),
  deliveryPercent: project.deliveryPercent, contractStart: project.contractStart,
  contractEnd: project.contractEnd, nextFollowUp: project.nextFollowUp,
  projectStatus: project.projectStatus,
  updatedAt: project.updatedAt, nextAction: project.nextFollowUp ? "Complete scheduled follow-up" : null,
});

const workflowCategory = (workflow: Awaited<ReturnType<typeof ensurePublishedWorkflow>>, stage: string) =>
  workflow?.states.find((state) => state.stableKey === stage)?.normalizedCategory ?? null;
const isPipelineCategory = (category: string | null) => category === "PRE_SALES";
const isActiveCategory = (category: string | null) => !!category && !["PRE_SALES", "COMPLETED", "CANCELED"].includes(category);
const activeProjectStatusKeys = (workflow: Awaited<ReturnType<typeof ensurePublishedWorkflow>>) =>
  new Set(workflow?.template.activeProjectStatusKeys?.length ? workflow.template.activeProjectStatusKeys : ["active", "waiting"]);

const addActivity = async (
  projectId: number,
  action: string,
  description: string,
  tenantId: number,
  environmentId: number,
) => {
  await db.insert(activityTable).values({
    projectId,
    tenantId,
    environmentId,
    action,
    description,
    actor: "You",
  });
};

router.get("/projects", async (req: TenantRequest, res) => {
  const parsed = ListProjectsQueryParams.safeParse({
    search: req.query.search,
    stage: req.query.stage,
  });
  const filters = parsed.success ? parsed.data : {};
  const conditions = [eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!)];

  if (filters.search) {
    const searchCondition = or(
        ilike(projectsTable.customerName, `%${filters.search}%`),
        ilike(projectsTable.projectName, `%${filters.search}%`),
        ilike(projectsTable.projectNumber, `%${filters.search}%`),
      );
    if (searchCondition) conditions.push(searchCondition);
  }
  if (filters.stage) {
    conditions.push(eq(projectsTable.stage, filters.stage));
  }

  const rows = await db
    .select()
    .from(projectsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projectsTable.updatedAt));
  res.json(rows.map(toProject));
});

router.post("/projects", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project details", details: parsed.error.issues });
    return;
  }

  if (parsed.data.businessCustomerId && parsed.data.newCustomer) {
    res.status(400).json({ error: "Choose an existing customer or create a new one, not both" });
    return;
  }
  if (parsed.data.newCustomer) {
    const role = await getCurrentTenantRole(req);
    if (role !== "owner" && role !== "admin") {
      res.status(403).json({ error: "Customer creation permission required" });
      return;
    }
  }
  const workflow = await ensurePublishedWorkflow(req.tenantId!, req.environmentId!, req.localUserId);
  if (!workflow) {
    res.status(409).json({ error: "No published project workflow is available." });
    return;
  }
  const initialState = workflow.states.find((state) => state.stableKey === parsed.data.stage)
    ?? workflow.states.find((state) => state.active);
  if (!initialState) {
    res.status(422).json({ error: "The project workflow has no active starting state." });
    return;
  }
  const initialStatus = parsed.data.projectStatus
    ?? initialState.defaultStatusKey
    ?? workflow.statuses.find((status) => status.active)?.stableKey
    ?? null;

  const [row] = await db.transaction(async (tx) => {
    let customerId = parsed.data.businessCustomerId ?? null;
    let customerName = parsed.data.customerName?.trim() ?? "";

    if (parsed.data.newCustomer) {
      const normalizedName = normalizeCustomerName(parsed.data.newCustomer.companyName);
      const [existing] = await tx.select().from(businessCustomersTable).where(and(
        eq(businessCustomersTable.tenantId, req.tenantId!),
        eq(businessCustomersTable.environmentId, req.environmentId!),
        eq(businessCustomersTable.normalizedName, normalizedName),
      ));
      if (existing?.status === "archived") {
        throw new Error("CUSTOMER_ARCHIVED");
      }
      if (existing) {
        customerId = existing.id;
        customerName = existing.companyName;
      } else {
        const [created] = await tx.insert(businessCustomersTable).values({
          tenantId: req.tenantId!,
          environmentId: req.environmentId!,
          companyName: parsed.data.newCustomer.companyName.trim(),
          normalizedName,
          customerType: parsed.data.newCustomer.customerType?.trim() || "business",
          primaryContact: parsed.data.newCustomer.primaryContact?.trim() || null,
          email: parsed.data.newCustomer.email?.trim().toLowerCase() || null,
          phone: parsed.data.newCustomer.phone?.trim() || null,
        }).returning();
        customerId = created.id;
        customerName = created.companyName;
        await tx.insert(platformAuditEventsTable).values({
          actorUserId: req.localUserId!,
          tenantId: req.tenantId!,
          action: "business_customer_created",
          details: JSON.stringify({ customerId: created.id, environmentId: req.environmentId, source: "project_create" }),
        });
      }
    } else if (customerId) {
      const [existing] = await tx.select().from(businessCustomersTable).where(and(
        eq(businessCustomersTable.id, customerId),
        eq(businessCustomersTable.tenantId, req.tenantId!),
        eq(businessCustomersTable.environmentId, req.environmentId!),
        eq(businessCustomersTable.status, "active"),
      ));
      if (!existing) throw new Error("CUSTOMER_NOT_FOUND");
      customerName = existing.companyName;
    }

    if (!customerId) throw new Error("CUSTOMER_REQUIRED");

    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(projectsTable);
    const projectNumber = `CP-${new Date().getFullYear()}-${String(Number(count) + 1).padStart(3, "0")}`;
    const {
      businessCustomerId: _businessCustomerId,
      newCustomer: _newCustomer,
      customerName: _legacyCustomerName,
      ...projectData
    } = parsed.data;
    const [createdProject] = await tx.insert(projectsTable).values({
      ...projectData,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      businessCustomerId: customerId,
      customerName,
      projectNumber,
      stage: initialState.stableKey,
      projectStatus: initialStatus,
      workflowTemplateId: workflow.template.id,
      productCategories: parsed.data.productCategories ?? [],
      contractValue: String(parsed.data.contractValue ?? 0),
      invoicedAmount: String(parsed.data.invoicedAmount ?? 0),
      receivedAmount: String(parsed.data.receivedAmount ?? 0),
      contractStart: toDateString(parsed.data.contractStart),
      contractEnd: toDateString(parsed.data.contractEnd),
      nextFollowUp: toDateString(parsed.data.nextFollowUp),
    }).returning();
    await tx.insert(activityTable).values({
      projectId: createdProject.id,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      action: "Project created",
      description: `New project opened for ${customerName}`,
      actor: "You",
    });
    return [createdProject];
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "CUSTOMER_ARCHIVED") {
      res.status(409).json({ error: "That customer is archived. Reactivate it before assigning a new project." });
      return [];
    }
    if (error instanceof Error && error.message === "CUSTOMER_NOT_FOUND") {
      res.status(404).json({ error: "Customer not found in the active environment" });
      return [];
    }
    if (error instanceof Error && error.message === "CUSTOMER_REQUIRED") {
      res.status(400).json({ error: "Select a customer or create a new customer before saving the project" });
      return [];
    }
    throw error;
  });
  if (!row) return;
  res.status(201).json(toProject(row));
});

router.get("/projects/:projectId", async (req: TenantRequest, res) => {
  const projectId = Number(req.params.projectId);
  const [row] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!)));
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(toProject(row));
});

router.patch("/projects/:projectId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateProjectParams.safeParse(req.params);
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid project update" });
    return;
  }

  const {
    businessCustomerId,
    newCustomer: _newCustomer,
    customerName: _legacyCustomerName,
    ...projectFields
  } = parsed.data;
  const [existingProject] = await db.select()
    .from(projectsTable)
    .where(and(
      eq(projectsTable.id, params.data.projectId),
      eq(projectsTable.tenantId, req.tenantId!),
      eq(projectsTable.environmentId, req.environmentId!),
    ));
  const updateData: Record<string, unknown> = {
    ...projectFields,
    updatedAt: new Date(),
  };
  if (!existingProject) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const workflow = await ensurePublishedWorkflow(req.tenantId!, req.environmentId!, req.localUserId);
  if (!workflow) {
    res.status(409).json({ error: "No published project workflow is available." });
    return;
  }
  if (!existingProject.workflowTemplateId) updateData.workflowTemplateId = workflow.template.id;
  if (businessCustomerId != null) {
    const [customer] = await db.select().from(businessCustomersTable).where(and(
      eq(businessCustomersTable.id, businessCustomerId),
      eq(businessCustomersTable.tenantId, req.tenantId!),
      eq(businessCustomersTable.environmentId, req.environmentId!),
      eq(businessCustomersTable.status, "active"),
    ));
    if (!customer) {
      res.status(404).json({ error: "Customer not found in the active environment" });
      return;
    }
    updateData.businessCustomerId = customer.id;
    updateData.customerName = customer.companyName;
  }
  if (parsed.data.contractValue !== undefined) {
    updateData.contractValue = String(parsed.data.contractValue);
  }
  if (parsed.data.invoicedAmount !== undefined) {
    updateData.invoicedAmount = String(parsed.data.invoicedAmount);
  }
  if (parsed.data.receivedAmount !== undefined) {
    updateData.receivedAmount = String(parsed.data.receivedAmount);
  }
  if (parsed.data.stage && parsed.data.stage !== existingProject.stage) {
    const role = await getCurrentTenantRole(req);
    const transition = validateProjectTransition(workflow, existingProject.stage, parsed.data.stage, role, {
      ...existingProject,
      ...updateData,
    });
    if (transition.error) {
      res.status(transition.error.includes("permission") ? 403 : 422).json({
        error: transition.error,
        warnings: transition.warnings ?? [],
      });
      return;
    }
    if (parsed.data.projectStatus === undefined) {
      updateData.projectStatus = workflow.states.find((state) => state.stableKey === parsed.data.stage)?.defaultStatusKey ?? null;
    }
  }

  const [row] = await db
    .update(projectsTable)
    .set(updateData)
    .where(and(eq(projectsTable.id, params.data.projectId), eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!)))
    .returning();
  const changedStage = parsed.data.stage && parsed.data.stage !== existingProject.stage
    ? ` Stage moved from ${existingProject.stage} to ${parsed.data.stage}.`
    : "";
  await addActivity(row.id, "Project updated", `Project details were updated.${changedStage}`, req.tenantId!, req.environmentId!);
  if (businessCustomerId != null && existingProject?.businessCustomerId !== businessCustomerId) {
    await addActivity(row.id, "Customer assigned", `Project assigned to ${row.customerName}.`, req.tenantId!, req.environmentId!);
    await db.insert(platformAuditEventsTable).values({
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      action: "project_customer_assigned",
      details: JSON.stringify({ projectId: row.id, customerId: businessCustomerId, environmentId: req.environmentId }),
    });
  }
  res.json(toProject(row));
});

router.delete("/projects/:projectId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const projectId = Number(req.params.projectId);
  const [row] = await db
    .delete(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!)))
    .returning({ id: projectsTable.id });
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.status(204).send();
});

router.get("/projects/:projectId/activity", async (req: TenantRequest, res) => {
  const projectId = Number(req.params.projectId);
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!)));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  const rows = await db
    .select({
      id: activityTable.id,
      projectId: activityTable.projectId,
      projectName: projectsTable.projectName,
      action: activityTable.action,
      description: activityTable.description,
      actor: activityTable.actor,
      createdAt: activityTable.createdAt,
    })
    .from(activityTable)
    .leftJoin(projectsTable, and(eq(activityTable.projectId, projectsTable.id), eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!)))
    .where(and(eq(activityTable.projectId, projectId), eq(activityTable.tenantId, req.tenantId!), eq(activityTable.environmentId, req.environmentId!)))
    .orderBy(desc(activityTable.createdAt));
  res.json(rows);
});

router.get("/follow-ups", async (req: TenantRequest, res) => {
  const rows = await db
    .select({
      id: followUpsTable.id,
      projectId: followUpsTable.projectId,
      customerName: projectsTable.customerName,
      projectName: projectsTable.projectName,
      dueDate: followUpsTable.dueDate,
      status: followUpsTable.status,
      note: followUpsTable.note,
      createdAt: followUpsTable.createdAt,
    })
    .from(followUpsTable)
    .innerJoin(projectsTable, and(eq(followUpsTable.projectId, projectsTable.id), eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!)))
    .where(and(eq(followUpsTable.tenantId, req.tenantId!), eq(followUpsTable.environmentId, req.environmentId!)))
    .orderBy(followUpsTable.dueDate);
  res.json(rows);
});

router.post("/follow-ups", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateFollowUpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid follow-up details" });
    return;
  }
  const [project] = await db
    .select({ customerName: projectsTable.customerName, projectName: projectsTable.projectName })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, parsed.data.projectId), eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!)));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [row] = await db
    .insert(followUpsTable)
    .values({
      ...parsed.data,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      dueDate: parsed.data.dueDate.toISOString().slice(0, 10),
    })
    .returning();
  await addActivity(row.projectId, "Follow-up scheduled", `Follow-up scheduled for ${row.dueDate}.`, req.tenantId!, req.environmentId!);
  res.status(201).json({
    ...row,
    customerName: project.customerName,
    projectName: project.projectName,
  });
});

router.patch("/follow-ups/:followUpId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateFollowUpParams.safeParse(req.params);
  const parsed = UpdateFollowUpBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid follow-up update" });
    return;
  }
  const [row] = await db
    .update(followUpsTable)
    .set({
      ...parsed.data,
      dueDate: toDateString(parsed.data.dueDate),
    })
    .where(and(eq(followUpsTable.id, params.data.followUpId), eq(followUpsTable.tenantId, req.tenantId!), eq(followUpsTable.environmentId, req.environmentId!)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Follow-up not found" });
    return;
  }
  const [project] = await db
    .select({ customerName: projectsTable.customerName, projectName: projectsTable.projectName })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, row.projectId), eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!)));
  res.json({
    ...row,
    customerName: project?.customerName ?? "Unknown customer",
    projectName: project?.projectName ?? "Unknown project",
  });
});

router.get("/dashboard/drilldown", async (req: TenantRequest, res) => {
  const parsed = GetDashboardDrilldownQueryParams.safeParse({
    type: req.query.type, stage: req.query.stage, search: req.query.search, sort: req.query.sort,
  });
  if (!parsed.success || (parsed.data.type === "stage" && !parsed.data.stage)) {
    res.status(400).json({ error: "type is required and stage is required for stage drilldown" });
    return;
  }
  const { type, stage, search } = parsed.data;
  const workflow = await ensurePublishedWorkflow(req.tenantId!, req.environmentId!, req.localUserId);
  const conditions = [eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!)];
  if (search) conditions.push(or(
    ilike(projectsTable.customerName, `%${search}%`),
    ilike(projectsTable.projectName, `%${search}%`),
    ilike(projectsTable.projectNumber, `%${search}%`),
  )!);
  const projects = await db.select().from(projectsTable).where(and(...conditions));
  const today = dateToday();
  const matches = type === "active-projects"
    ? projects.filter((p) =>
        isActiveCategory(workflowCategory(workflow, p.stage))
        && activeProjectStatusKeys(workflow).has(p.projectStatus?.toLowerCase() ?? ""))
    : type === "pipeline-value"
      ? projects.filter((p) => isPipelineCategory(workflowCategory(workflow, p.stage)))
      : type === "stage"
        ? projects.filter((p) => p.stage === stage)
        : [];
  if (type === "open-follow-ups") {
    const rows = await db.select({
      id: followUpsTable.id, projectId: followUpsTable.projectId, customerName: projectsTable.customerName,
      projectName: projectsTable.projectName, owner: projectsTable.owner, dueDate: followUpsTable.dueDate,
      status: followUpsTable.status, note: followUpsTable.note,
    }).from(followUpsTable).innerJoin(projectsTable, and(
      eq(followUpsTable.projectId, projectsTable.id),
      eq(followUpsTable.tenantId, req.tenantId!), eq(followUpsTable.environmentId, req.environmentId!),
      eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!),
    )).where(and(eq(followUpsTable.tenantId, req.tenantId!), eq(followUpsTable.environmentId, req.environmentId!), eq(followUpsTable.status, "open")))
      .orderBy(followUpsTable.dueDate);
    const followups = rows.filter((r) => !search || `${r.customerName} ${r.projectName} ${r.note}`.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (a.dueDate < today ? 0 : a.dueDate === today ? 1 : 2) - (b.dueDate < today ? 0 : b.dueDate === today ? 1 : 2) || a.dueDate.localeCompare(b.dueDate))
      .map((r) => ({ ...r, priority: r.dueDate < today ? "overdue" : r.dueDate === today ? "due_today" : "upcoming" }));
    res.json({ title: "Open Follow-ups", type, count: followups.length, total: followups.length, followups });
    return;
  }
  if (type === "received-to-date") {
    const received = projects.filter((p) => Number(p.receivedAmount) !== 0).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(projectContribution);
    res.json({ title: "Received to Date", type, count: received.length, total: received.reduce((sum, p) => sum + p.receivedAmount, 0), projects: received });
    return;
  }
  if (type === "needs-attention") {
    const activity = await db.select({ projectId: activityTable.projectId, createdAt: activityTable.createdAt }).from(activityTable)
      .where(and(eq(activityTable.tenantId, req.tenantId!), eq(activityTable.environmentId, req.environmentId!)));
    const latest = new Map<number, Date>();
    for (const item of activity) if (!latest.has(item.projectId)) latest.set(item.projectId, item.createdAt);
    const attention = projects.map((p) => {
      const reasons: string[] = [];
      if (p.nextFollowUp && p.nextFollowUp < today) reasons.push("nextFollowUp overdue");
       if (isActiveCategory(workflowCategory(workflow, p.stage)) && !p.contractEnd) reasons.push("missing target completion for active work");
      const last = latest.get(p.id) ?? p.updatedAt;
      if (daysSince(last) > 30) reasons.push("no activity for more than 30 days");
      return { project: projectContribution(p), reasons, severity: reasons.some((r) => r.includes("overdue")) ? "high" : reasons.length > 1 ? "medium" : "low", ageDays: daysSince(last), recommendedAction: reasons.some((r) => r.includes("overdue")) ? "Review and complete the overdue action" : "Review project status and schedule next action" };
    }).filter((r) => r.reasons.length > 0 && (!search || `${r.project.customerName} ${r.project.projectName}`.toLowerCase().includes(search.toLowerCase())));
    res.json({ title: "Projects Needing Attention", type, count: attention.length, total: attention.length, attention });
    return;
  }
  const ordered = [...matches].sort((a, b) => Number(b.contractValue) - Number(a.contractValue));
  const projected = ordered.map(projectContribution);
  res.json({ title: type === "active-projects" ? "Active Projects" : type === "pipeline-value" ? "Pipeline Value" : `Stage: ${stage}`, type, count: projected.length, total: projected.reduce((sum, p) => sum + p.contractValue, 0), projects: projected });
});

router.get("/dashboard/summary", async (req: TenantRequest, res) => {
  const [projects, followUps, workflow] = await Promise.all([
    db.select().from(projectsTable).where(and(eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!))),
    db.select({ status: followUpsTable.status }).from(followUpsTable).where(and(eq(followUpsTable.tenantId, req.tenantId!), eq(followUpsTable.environmentId, req.environmentId!))),
    ensurePublishedWorkflow(req.tenantId!, req.environmentId!, req.localUserId),
  ]);
  const stageCounts = (workflow?.states.filter((state) => state.active).sort((a, b) => a.displayOrder - b.displayOrder) ?? []).map((state) => {
    const matching = projects.filter((project) => project.stage === state.stableKey);
    return {
      stage: state.stableKey,
      count: matching.length,
      value: matching.reduce((sum, project) => sum + Number(project.contractValue), 0),
    };
  });
  res.json({
    activeProjects: projects.filter((project) =>
      isActiveCategory(workflowCategory(workflow, project.stage))
      && activeProjectStatusKeys(workflow).has(project.projectStatus?.toLowerCase() ?? "")).length,
    pipelineValue: projects
      .filter((project) => isPipelineCategory(workflowCategory(workflow, project.stage)))
      .reduce((sum, project) => sum + Number(project.contractValue), 0),
    awardedValue: projects
      .filter((project) => isActiveCategory(workflowCategory(workflow, project.stage)))
      .reduce((sum, project) => sum + Number(project.contractValue), 0),
    invoicedValue: projects.reduce((sum, project) => sum + Number(project.invoicedAmount), 0),
    receivedValue: projects.reduce((sum, project) => sum + Number(project.receivedAmount), 0),
    openFollowUps: followUps.filter((followUp) => followUp.status === "open").length,
    stageCounts,
  });
});

router.get("/dashboard/activity", async (req: TenantRequest, res) => {
  const rows = await db
    .select({
      id: activityTable.id,
      projectId: activityTable.projectId,
      projectName: projectsTable.projectName,
      action: activityTable.action,
      description: activityTable.description,
      actor: activityTable.actor,
      createdAt: activityTable.createdAt,
    })
    .from(activityTable)
    .leftJoin(projectsTable, eq(activityTable.projectId, projectsTable.id))
    .where(and(eq(activityTable.tenantId, req.tenantId!), eq(activityTable.environmentId, req.environmentId!)))
    .orderBy(desc(activityTable.createdAt))
    .limit(12);
  res.json(rows);
});

export default router;