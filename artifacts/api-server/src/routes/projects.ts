import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  activityTable,
  db,
  followUpsTable,
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
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";

const router: IRouter = Router();

const projectStages = [
  "lead",
  "proposal",
  "awarded",
  "contracted",
  "in_progress",
  "billing",
  "closeout",
  "follow_up",
  "lost",
] as const;

const toProject = (row: typeof projectsTable.$inferSelect) => ({
  ...row,
  contractValue: Number(row.contractValue),
  invoicedAmount: Number(row.invoicedAmount),
  receivedAmount: Number(row.receivedAmount),
});

const toDateString = (value: Date | undefined) =>
  value ? value.toISOString().slice(0, 10) : undefined;

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

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectsTable);
  const projectNumber = `CP-${new Date().getFullYear()}-${String(Number(count) + 1).padStart(3, "0")}`;
  const [row] = await db
    .insert(projectsTable)
    .values({
      ...parsed.data,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      projectNumber,
      productCategories: parsed.data.productCategories ?? [],
      contractValue: String(parsed.data.contractValue ?? 0),
      invoicedAmount: String(parsed.data.invoicedAmount ?? 0),
      receivedAmount: String(parsed.data.receivedAmount ?? 0),
      contractStart: toDateString(parsed.data.contractStart),
      contractEnd: toDateString(parsed.data.contractEnd),
      nextFollowUp: toDateString(parsed.data.nextFollowUp),
    })
    .returning();
  await addActivity(row.id, "Project created", `New project opened for ${row.customerName}`, req.tenantId!, req.environmentId!);
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

  const updateData: Record<string, unknown> = {
    ...parsed.data,
    updatedAt: new Date(),
  };
  if (parsed.data.contractValue !== undefined) {
    updateData.contractValue = String(parsed.data.contractValue);
  }
  if (parsed.data.invoicedAmount !== undefined) {
    updateData.invoicedAmount = String(parsed.data.invoicedAmount);
  }
  if (parsed.data.receivedAmount !== undefined) {
    updateData.receivedAmount = String(parsed.data.receivedAmount);
  }

  const [row] = await db
    .update(projectsTable)
    .set(updateData)
    .where(and(eq(projectsTable.id, params.data.projectId), eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const changedStage = parsed.data.stage ? ` Stage moved to ${parsed.data.stage}.` : "";
   await addActivity(row.id, "Project updated", `Project details were updated.${changedStage}`, req.tenantId!, req.environmentId!);
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
    .leftJoin(projectsTable, eq(activityTable.projectId, projectsTable.id))
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
    .innerJoin(projectsTable, eq(followUpsTable.projectId, projectsTable.id))
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

router.get("/dashboard/summary", async (req: TenantRequest, res) => {
  const [projects, followUps] = await Promise.all([
    db.select().from(projectsTable).where(and(eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!))),
    db.select({ status: followUpsTable.status }).from(followUpsTable).where(and(eq(followUpsTable.tenantId, req.tenantId!), eq(followUpsTable.environmentId, req.environmentId!))),
  ]);
  const stageCounts = projectStages.map((stage) => {
    const matching = projects.filter((project) => project.stage === stage);
    return {
      stage,
      count: matching.length,
      value: matching.reduce((sum, project) => sum + Number(project.contractValue), 0),
    };
  });
  res.json({
    activeProjects: projects.filter((project) => project.stage !== "lost" && project.stage !== "closeout").length,
    pipelineValue: projects
      .filter((project) => project.stage !== "lost")
      .reduce((sum, project) => sum + Number(project.contractValue), 0),
    awardedValue: projects
      .filter((project) => ["awarded", "contracted", "in_progress", "billing", "closeout"].includes(project.stage))
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