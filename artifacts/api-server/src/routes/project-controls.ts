import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  bidsTable,
  db,
  projectChangeOrdersTable,
  projectCommitmentsTable,
  projectContractsTable,
  projectControlEventsTable,
  projectFinancialsTable,
  projectIssuesTable,
  projectIssueNumberSequencesTable,
  projectPayApplicationsTable,
  projectCloseoutRequirementsTable,
  projectScheduleItemsTable,
  projectsTable,
  scheduleOfValuesTable,
  submittalPackagesTable,
  contractParticipantsTable,
} from "@workspace/db";
import {
  CreateProjectChangeOrderBody,
  CreateProjectCommitmentBody,
  CreateProjectIssueBody,
  CreateProjectScheduleItemBody,
  CreateScheduleOfValueBody,
  GetProjectControlsParams,
  UpsertProjectContractBody,
  UpsertProjectContractParams,
  CreateProjectScheduleItemParams,
  UpdateProjectScheduleItemParams,
  UpdateScheduleOfValueParams,
  DeleteScheduleOfValueParams,
  CreateScheduleOfValueParams,
  CreateProjectCommitmentParams,
  UpdateProjectCommitmentParams,
  CreateProjectIssueParams,
  UpdateProjectIssueParams,
  CreateProjectChangeOrderParams,
  UpdateProjectChangeOrderParams,
  UpdateProjectFinancialsParams,
  UpdateProjectFinancialsBody,
  UpdateProjectChangeOrderBody,
  UpdateProjectCommitmentBody,
  UpdateProjectIssueBody,
  UpdateProjectScheduleItemBody,
  UpdateScheduleOfValueBody,
  CreateProjectPayApplicationParams,
  CreateProjectPayApplicationBody,
  UpdateProjectPayApplicationParams,
  UpdateProjectPayApplicationBody,
  CreateProjectCloseoutRequirementParams,
  CreateProjectCloseoutRequirementBody,
  UpdateProjectCloseoutRequirementParams,
  UpdateProjectCloseoutRequirementBody,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { getCurrentTenantRole, requireRole } from "../middlewares/rbac";
import { canApproveProjectChange } from "../lib/project-control-policy";

const router: IRouter = Router();

const scope = (req: TenantRequest, table: { tenantId: any; environmentId: any }) =>
  and(eq(table.tenantId, req.tenantId!), eq(table.environmentId, req.environmentId!));

const money = (value: string | number | null | undefined) => Number(value ?? 0);
const nullableDate = (value: Date | string | null | undefined) =>
  value == null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : value;

async function allocateIssueNumber(req: TenantRequest, projectId: number, issueType: string) {
  const [sequence] = await db.insert(projectIssueNumberSequencesTable).values({
    projectId,
    issueType,
    lastNumber: 1,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).onConflictDoUpdate({
    target: [
      projectIssueNumberSequencesTable.tenantId,
      projectIssueNumberSequencesTable.environmentId,
      projectIssueNumberSequencesTable.projectId,
      projectIssueNumberSequencesTable.issueType,
    ],
    set: {
      lastNumber: sql`${projectIssueNumberSequencesTable.lastNumber} + 1`,
      updatedAt: new Date(),
    },
  }).returning({ lastNumber: projectIssueNumberSequencesTable.lastNumber });
  if (!sequence) throw new Error("Unable to allocate a project issue number");
  return `${issueType === "rfi" ? "RFI" : "ISS"}-${String(sequence.lastNumber).padStart(3, "0")}`;
}

function toScheduleItem(row: typeof projectScheduleItemsTable.$inferSelect) {
  return { ...row };
}
function toSov(row: typeof scheduleOfValuesTable.$inferSelect) {
  return {
    ...row,
    scheduledValue: money(row.scheduledValue),
    approvedValue: money(row.approvedValue),
    billedToDate: money(row.billedToDate),
    percentComplete: money(row.percentComplete),
    retentionHeld: money(row.retentionHeld),
  };
}
function toCommitment(row: typeof projectCommitmentsTable.$inferSelect) {
  return {
    ...row,
    committedValue: money(row.committedValue),
    invoicedValue: money(row.invoicedValue),
    paidValue: money(row.paidValue),
  };
}
function toIssue(row: typeof projectIssuesTable.$inferSelect) {
  return { ...row, costImpact: money(row.costImpact) };
}
function toChangeOrder(row: typeof projectChangeOrdersTable.$inferSelect) {
  return {
    ...row,
    proposedValue: money(row.proposedValue),
    approvedValue: money(row.approvedValue),
  };
}
function toFinancials(row: typeof projectFinancialsTable.$inferSelect) {
  return {
    ...row,
    budgetCost: money(row.budgetCost),
    forecastCost: money(row.forecastCost),
    actualCost: money(row.actualCost),
    forecastRevenue: money(row.forecastRevenue),
    retainageHeld: money(row.retainageHeld),
  };
}
function toPayApplication(row: typeof projectPayApplicationsTable.$inferSelect) {
  return {
    ...row,
    grossAmount: money(row.grossAmount),
    retainageAmount: money(row.retainageAmount),
    netAmount: money(row.netAmount),
  };
}

async function getProject(req: TenantRequest, projectId: number) {
  const [project] = await db.select().from(projectsTable).where(and(
    eq(projectsTable.id, projectId),
    eq(projectsTable.tenantId, req.tenantId!),
    eq(projectsTable.environmentId, req.environmentId!),
  ));
  return project;
}

async function appendEvent(req: TenantRequest, projectId: number, entityType: string, entityId: number, action: string, details?: string, fromStatus?: string | null, toStatus?: string | null) {
  await db.insert(projectControlEventsTable).values({
    projectId,
    entityType,
    entityId,
    action,
    details: details ?? null,
    fromStatus: fromStatus ?? null,
    toStatus: toStatus ?? null,
    actorUserId: req.localUserId ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  });
}

async function validateLinkedRecords(req: TenantRequest, projectId: number, linkedBidId?: number | null, linkedSubmittalPackageId?: number | null) {
  if (linkedBidId) {
    const [bid] = await db.select({ id: bidsTable.id }).from(bidsTable).where(and(
      eq(bidsTable.id, linkedBidId),
      eq(bidsTable.tenantId, req.tenantId!),
      eq(bidsTable.environmentId, req.environmentId!),
    ));
    if (!bid) return "Linked bid is not in the active customer environment.";
  }
  if (linkedSubmittalPackageId) {
    const [packageRow] = await db.select({ id: submittalPackagesTable.id }).from(submittalPackagesTable).where(and(
      eq(submittalPackagesTable.id, linkedSubmittalPackageId),
      eq(submittalPackagesTable.projectId, projectId),
      eq(submittalPackagesTable.tenantId, req.tenantId!),
      eq(submittalPackagesTable.environmentId, req.environmentId!),
    ));
    if (!packageRow) return "Linked submittal package is not part of this project.";
  }
  return null;
}

router.get("/projects/:projectId/controls", async (req: TenantRequest, res) => {
  const params = GetProjectControlsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid project id" }); return; }
  const project = await getProject(req, params.data.projectId);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  const projectId = project.id;
  const [contract] = await db.select().from(projectContractsTable).where(and(scope(req, projectContractsTable), eq(projectContractsTable.projectId, projectId))).limit(1);
  const [scheduleItems, sovLines, commitments, issues, changeOrders, financials, events, payApplications, closeoutRequirements] = await Promise.all([
    db.select().from(projectScheduleItemsTable).where(and(scope(req, projectScheduleItemsTable), eq(projectScheduleItemsTable.projectId, projectId))).orderBy(asc(projectScheduleItemsTable.plannedEnd)),
    db.select().from(scheduleOfValuesTable).where(and(scope(req, scheduleOfValuesTable), eq(scheduleOfValuesTable.projectId, projectId))).orderBy(asc(scheduleOfValuesTable.lineNumber)),
    db.select().from(projectCommitmentsTable).where(and(scope(req, projectCommitmentsTable), eq(projectCommitmentsTable.projectId, projectId))).orderBy(desc(projectCommitmentsTable.updatedAt)),
    db.select().from(projectIssuesTable).where(and(scope(req, projectIssuesTable), eq(projectIssuesTable.projectId, projectId))).orderBy(desc(projectIssuesTable.updatedAt)),
    db.select().from(projectChangeOrdersTable).where(and(scope(req, projectChangeOrdersTable), eq(projectChangeOrdersTable.projectId, projectId))).orderBy(desc(projectChangeOrdersTable.updatedAt)),
    db.select().from(projectFinancialsTable).where(and(scope(req, projectFinancialsTable), eq(projectFinancialsTable.projectId, projectId))).limit(1),
    db.select().from(projectControlEventsTable).where(and(scope(req, projectControlEventsTable), eq(projectControlEventsTable.projectId, projectId))).orderBy(desc(projectControlEventsTable.createdAt)).limit(20),
    db.select().from(projectPayApplicationsTable).where(and(scope(req, projectPayApplicationsTable), eq(projectPayApplicationsTable.projectId, projectId))).orderBy(desc(projectPayApplicationsTable.updatedAt)),
    db.select().from(projectCloseoutRequirementsTable).where(and(scope(req, projectCloseoutRequirementsTable), eq(projectCloseoutRequirementsTable.projectId, projectId))).orderBy(asc(projectCloseoutRequirementsTable.dueDate)),
  ]);
  const participants = contract
    ? await db.select().from(contractParticipantsTable).where(and(scope(req, contractParticipantsTable), eq(contractParticipantsTable.contractId, contract.id))).orderBy(asc(contractParticipantsTable.organizationName))
    : [];
  const contractRow = contract ? {
    ...contract,
    originalValue: money(contract.originalValue),
    currentValue: money(contract.currentValue),
    retainagePercent: money(contract.retainagePercent),
    retainageCap: contract.retainageCap == null ? null : money(contract.retainageCap),
    participants,
  } : null;
  const committedCost = commitments.reduce((sum, row) => sum + money(row.committedValue), 0);
  const approvedChanges = changeOrders.reduce((sum, row) => sum + money(row.approvedValue), 0);
  const financial = financials[0] ? toFinancials(financials[0]) : null;
  const forecastCost = financial?.forecastCost ?? committedCost;
  const forecastRevenue = financial?.forecastRevenue ?? contractRow?.currentValue ?? money(project.contractValue);
  const today = new Date().toISOString().slice(0, 10);
  const openIssues = issues.filter((row) => row.status !== "closed");
  const overdueIssues = openIssues.filter((row) => row.dueDate && row.dueDate < today).length;
  const pendingChanges = changeOrders.filter((row) => row.approvalStatus === "pending").length;
  const scheduleRiskDays = Math.max(
    0,
    ...scheduleItems.filter((row) => row.status === "delayed").map((row) => row.plannedEnd ? Math.max(0, Math.floor((Date.now() - new Date(row.plannedEnd).getTime()) / 86400000)) : 0),
    ...issues.map((row) => row.scheduleImpactDays),
    ...changeOrders.map((row) => row.scheduleImpactDays),
  );
  const closeoutReadiness = Math.min(100, Math.max(0, Math.round(
    (project.closeoutStatus === "complete" ? 70 : project.closeoutStatus === "customer_review" ? 50 : project.closeoutStatus === "punch_list" ? 30 : 10)
    + (issues.length === 0 ? 20 : 0)
    + (pendingChanges === 0 ? 10 : 0)
    + (closeoutRequirements.length > 0
      ? (closeoutRequirements.filter((item) => ["complete", "waived"].includes(item.status)).length / closeoutRequirements.length) * 20
      : 0),
  )));
  res.json({
    projectId,
    contract: contractRow,
    scheduleItems: scheduleItems.map(toScheduleItem),
    sovLines: sovLines.map(toSov),
    commitments: commitments.map(toCommitment),
    issues: issues.map(toIssue),
    changeOrders: changeOrders.map(toChangeOrder),
    payApplications: payApplications.map(toPayApplication),
    closeoutRequirements,
    financials: financial,
    metrics: {
      contractValue: forecastRevenue,
      committedCost,
      forecastCost,
      forecastMargin: forecastRevenue - forecastCost,
      openIssues: openIssues.length,
      overdueIssues,
      pendingChanges,
      scheduleRiskDays,
      billedToDate: sovLines.reduce((sum, row) => sum + money(row.billedToDate), 0),
      retainageHeld: (financial?.retainageHeld ?? 0) + sovLines.reduce((sum, row) => sum + money(row.retentionHeld), 0),
      closeoutReadiness,
    },
    events: events.map((event) => ({
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      comments: event.comments,
      createdAt: event.createdAt,
    })),
  });
});

router.get("/dashboard/project-controls", async (req: TenantRequest, res) => {
  const [projects, commitments, issues, changeOrders, financials] = await Promise.all([
    db.select().from(projectsTable).where(and(eq(projectsTable.tenantId, req.tenantId!), eq(projectsTable.environmentId, req.environmentId!))),
    db.select().from(projectCommitmentsTable).where(scope(req, projectCommitmentsTable)),
    db.select().from(projectIssuesTable).where(scope(req, projectIssuesTable)),
    db.select().from(projectChangeOrdersTable).where(scope(req, projectChangeOrdersTable)),
    db.select().from(projectFinancialsTable).where(scope(req, projectFinancialsTable)),
  ]);
  const committedCost = commitments.reduce((sum, row) => sum + money(row.committedValue), 0);
  const forecastCost = financials.reduce((sum, row) => sum + money(row.forecastCost), 0) || committedCost;
  const contractValue = projects.reduce((sum, row) => sum + money(row.contractValue), 0);
  const forecastRevenue = financials.reduce((sum, row) => sum + money(row.forecastRevenue), 0) || contractValue;
  const openIssues = issues.filter((row) => row.status !== "closed");
  const pendingChanges = changeOrders.filter((row) => row.approvalStatus === "pending");
  const scheduleRiskDays = Math.max(0, ...issues.map((row) => row.scheduleImpactDays), ...changeOrders.map((row) => row.scheduleImpactDays));
  const closeoutReadyProjects = projects.filter((project) => project.closeoutStatus === "complete").length;
  res.json({
    activeProjects: projects.filter((project) => !["closeout"].includes(project.stage)).length,
    contractValue,
    committedCost,
    forecastCost,
    forecastMargin: forecastRevenue - forecastCost,
    openDecisions: openIssues.length,
    pendingChanges: pendingChanges.length,
    scheduleRiskDays,
    billingPending: projects.reduce((sum, row) => sum + Math.max(0, money(row.invoicedAmount) - money(row.receivedAmount)), 0),
    closeoutReadyProjects,
  });
});

router.put("/projects/:projectId/controls/contract", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpsertProjectContractParams.safeParse(req.params);
  const parsed = UpsertProjectContractBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid contract details" }); return; }
  if (!await getProject(req, params.data.projectId)) { res.status(404).json({ error: "Project not found" }); return; }
  const data = parsed.data;
  const [existing] = await db.select().from(projectContractsTable).where(and(scope(req, projectContractsTable), eq(projectContractsTable.projectId, params.data.projectId))).limit(1);
  const contractValues = {
    projectId: params.data.projectId,
    contractNumber: data.contractNumber,
    deliveryMethod: data.deliveryMethod,
    originalValue: String(data.originalValue),
    currentValue: String(data.currentValue),
    contractStart: nullableDate(data.contractStart),
    contractEnd: nullableDate(data.contractEnd),
    noticeToProceed: nullableDate(data.noticeToProceed),
    paymentTerms: data.paymentTerms ?? null,
    retainagePercent: String(data.retainagePercent ?? 0),
    retainageCap: data.retainageCap == null ? null : String(data.retainageCap),
    approvalStatus: data.approvalStatus ?? "draft",
    status: data.status ?? "active",
    documentUrl: data.documentUrl ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
    updatedAt: new Date(),
  };
  const [row] = existing
    ? await db.update(projectContractsTable).set(contractValues).where(and(eq(projectContractsTable.id, existing.id), scope(req, projectContractsTable))).returning()
    : await db.insert(projectContractsTable).values(contractValues).returning();
  if (data.participants) {
    await db.delete(contractParticipantsTable).where(and(scope(req, contractParticipantsTable), eq(contractParticipantsTable.contractId, row.id)));
    if (data.participants.length) {
      await db.insert(contractParticipantsTable).values(data.participants.map((participant) => ({
        ...participant,
        contactName: participant.contactName ?? null,
        contactEmail: participant.contactEmail ?? null,
        role: participant.role ?? null,
        contractId: row.id,
        tenantId: req.tenantId!,
        environmentId: req.environmentId!,
      })));
    }
  }
  await appendEvent(req, params.data.projectId, "contract", row.id, existing ? "contract_updated" : "contract_created", JSON.stringify({ approvalStatus: row.approvalStatus }));
  const participants = await db.select().from(contractParticipantsTable).where(and(scope(req, contractParticipantsTable), eq(contractParticipantsTable.contractId, row.id)));
  res.json({ ...row, originalValue: money(row.originalValue), currentValue: money(row.currentValue), retainagePercent: money(row.retainagePercent), retainageCap: row.retainageCap == null ? null : money(row.retainageCap), participants });
});

router.post("/projects/:projectId/controls/schedule", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = CreateProjectScheduleItemParams.safeParse(req.params);
  const parsed = CreateProjectScheduleItemBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid schedule item" }); return; }
  if (!await getProject(req, params.data.projectId)) { res.status(404).json({ error: "Project not found" }); return; }
  const [row] = await db.insert(projectScheduleItemsTable).values({
    ...parsed.data,
    projectId: params.data.projectId,
    contractId: null,
    parentItemId: null,
    predecessor: parsed.data.predecessor ?? null,
    plannedStart: nullableDate(parsed.data.plannedStart),
    plannedEnd: nullableDate(parsed.data.plannedEnd),
    actualStart: nullableDate(parsed.data.actualStart),
    actualEnd: nullableDate(parsed.data.actualEnd),
    itemType: parsed.data.itemType ?? "milestone",
    status: parsed.data.status ?? "planned",
    ownerName: parsed.data.ownerName ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await appendEvent(req, params.data.projectId, "schedule", row.id, "schedule_item_created");
  res.status(201).json(toScheduleItem(row));
});

router.patch("/projects/:projectId/controls/schedule/:itemId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateProjectScheduleItemParams.safeParse({ projectId: req.params.projectId, itemId: req.params.itemId });
  const parsed = UpdateProjectScheduleItemBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid schedule update" }); return; }
  const [row] = await db.update(projectScheduleItemsTable).set({
    ...parsed.data,
    predecessor: parsed.data.predecessor === undefined ? undefined : parsed.data.predecessor,
    plannedStart: parsed.data.plannedStart === undefined ? undefined : nullableDate(parsed.data.plannedStart),
    plannedEnd: parsed.data.plannedEnd === undefined ? undefined : nullableDate(parsed.data.plannedEnd),
    actualStart: parsed.data.actualStart === undefined ? undefined : nullableDate(parsed.data.actualStart),
    actualEnd: parsed.data.actualEnd === undefined ? undefined : nullableDate(parsed.data.actualEnd),
    updatedAt: new Date(),
  }).where(and(scope(req, projectScheduleItemsTable), eq(projectScheduleItemsTable.projectId, params.data.projectId), eq(projectScheduleItemsTable.id, params.data.itemId))).returning();
  if (!row) { res.status(404).json({ error: "Schedule item not found" }); return; }
  await appendEvent(req, params.data.projectId, "schedule", row.id, "schedule_item_updated");
  res.json(toScheduleItem(row));
});

router.post("/projects/:projectId/controls/sov", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = CreateScheduleOfValueParams.safeParse(req.params);
  const parsed = CreateScheduleOfValueBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid schedule of values line" }); return; }
  if (!await getProject(req, params.data.projectId)) { res.status(404).json({ error: "Project not found" }); return; }
  const [row] = await db.insert(scheduleOfValuesTable).values({
    ...parsed.data,
    projectId: params.data.projectId,
    contractId: null,
    costCode: parsed.data.costCode ?? null,
    scheduledValue: String(parsed.data.scheduledValue),
    approvedValue: String(parsed.data.approvedValue ?? parsed.data.scheduledValue),
    billedToDate: String(parsed.data.billedToDate ?? 0),
    percentComplete: String(parsed.data.percentComplete ?? 0),
    retentionHeld: String(parsed.data.retentionHeld ?? 0),
    status: parsed.data.status ?? "draft",
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await appendEvent(req, params.data.projectId, "sov", row.id, "sov_line_created");
  res.status(201).json(toSov(row));
});

router.patch("/projects/:projectId/controls/sov/:lineId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateScheduleOfValueParams.safeParse({ projectId: req.params.projectId, lineId: req.params.lineId });
  const parsed = UpdateScheduleOfValueBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid schedule of values update" }); return; }
  const data = parsed.data;
  const [row] = await db.update(scheduleOfValuesTable).set({
    ...data,
    scheduledValue: data.scheduledValue === undefined ? undefined : String(data.scheduledValue),
    approvedValue: data.approvedValue === undefined ? undefined : String(data.approvedValue),
    billedToDate: data.billedToDate === undefined ? undefined : String(data.billedToDate),
    percentComplete: data.percentComplete === undefined ? undefined : String(data.percentComplete),
    retentionHeld: data.retentionHeld === undefined ? undefined : String(data.retentionHeld),
    updatedAt: new Date(),
  }).where(and(scope(req, scheduleOfValuesTable), eq(scheduleOfValuesTable.projectId, params.data.projectId), eq(scheduleOfValuesTable.id, params.data.lineId))).returning();
  if (!row) { res.status(404).json({ error: "Schedule of values line not found" }); return; }
  await appendEvent(req, params.data.projectId, "sov", row.id, "sov_line_updated");
  res.json(toSov(row));
});

router.delete("/projects/:projectId/controls/sov/:lineId", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const params = DeleteScheduleOfValueParams.safeParse({ projectId: req.params.projectId, lineId: req.params.lineId });
  if (!params.success) { res.status(400).json({ error: "Invalid schedule of values id" }); return; }
  const [row] = await db.delete(scheduleOfValuesTable).where(and(scope(req, scheduleOfValuesTable), eq(scheduleOfValuesTable.projectId, params.data.projectId), eq(scheduleOfValuesTable.id, params.data.lineId))).returning();
  if (!row) { res.status(404).json({ error: "Schedule of values line not found" }); return; }
  await appendEvent(req, params.data.projectId, "sov", row.id, "sov_line_deleted");
  res.status(204).send();
});

router.post("/projects/:projectId/controls/commitments", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = CreateProjectCommitmentParams.safeParse(req.params);
  const parsed = CreateProjectCommitmentBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid commitment" }); return; }
  if (!await getProject(req, params.data.projectId)) { res.status(404).json({ error: "Project not found" }); return; }
  const linkError = await validateLinkedRecords(req, params.data.projectId, parsed.data.linkedBidId, parsed.data.linkedSubmittalPackageId);
  if (linkError) { res.status(422).json({ error: linkError }); return; }
  const [row] = await db.insert(projectCommitmentsTable).values({
    ...parsed.data,
    projectId: params.data.projectId,
    contractId: null,
    linkedBidId: parsed.data.linkedBidId ?? null,
    linkedSubmittalPackageId: parsed.data.linkedSubmittalPackageId ?? null,
    description: parsed.data.description ?? null,
    status: parsed.data.status ?? "draft",
    committedValue: String(parsed.data.committedValue),
    invoicedValue: String(parsed.data.invoicedValue ?? 0),
    paidValue: String(parsed.data.paidValue ?? 0),
    dueDate: nullableDate(parsed.data.dueDate),
    documentUrl: parsed.data.documentUrl ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await appendEvent(req, params.data.projectId, "commitment", row.id, "commitment_created");
  res.status(201).json(toCommitment(row));
});

router.patch("/projects/:projectId/controls/commitments/:commitmentId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateProjectCommitmentParams.safeParse({ projectId: req.params.projectId, commitmentId: req.params.commitmentId });
  const parsed = UpdateProjectCommitmentBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid commitment update" }); return; }
  const data = parsed.data;
  const [row] = await db.update(projectCommitmentsTable).set({
    ...data,
    description: data.description === undefined ? undefined : data.description,
    invoicedValue: data.invoicedValue === undefined ? undefined : String(data.invoicedValue),
    paidValue: data.paidValue === undefined ? undefined : String(data.paidValue),
    dueDate: data.dueDate === undefined ? undefined : nullableDate(data.dueDate),
    updatedAt: new Date(),
  }).where(and(scope(req, projectCommitmentsTable), eq(projectCommitmentsTable.projectId, params.data.projectId), eq(projectCommitmentsTable.id, params.data.commitmentId))).returning();
  if (!row) { res.status(404).json({ error: "Commitment not found" }); return; }
  await appendEvent(req, params.data.projectId, "commitment", row.id, "commitment_updated", undefined, undefined, row.status);
  res.json(toCommitment(row));
});

router.post("/projects/:projectId/controls/issues", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = CreateProjectIssueParams.safeParse(req.params);
  const parsed = CreateProjectIssueBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid issue" }); return; }
  if (!await getProject(req, params.data.projectId)) { res.status(404).json({ error: "Project not found" }); return; }
  const linkError = await validateLinkedRecords(req, params.data.projectId, null, parsed.data.linkedSubmittalPackageId);
  if (linkError) { res.status(422).json({ error: linkError }); return; }
  const issueNumber = await allocateIssueNumber(req, params.data.projectId, parsed.data.issueType);
  const [row] = await db.insert(projectIssuesTable).values({
    ...parsed.data,
    projectId: params.data.projectId,
    issueNumber,
    ownerUserId: parsed.data.ownerUserId ?? null,
    responsibleParty: parsed.data.responsibleParty ?? null,
    status: parsed.data.status ?? "open",
    priority: parsed.data.priority ?? "normal",
    dueDate: nullableDate(parsed.data.dueDate),
    response: parsed.data.response ?? null,
    documentUrl: parsed.data.documentUrl ?? null,
    costImpact: String(parsed.data.costImpact ?? 0),
    scheduleImpactDays: parsed.data.scheduleImpactDays ?? 0,
    linkedSubmittalPackageId: parsed.data.linkedSubmittalPackageId ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await appendEvent(req, params.data.projectId, "issue", row.id, "issue_created", undefined, undefined, row.status);
  res.status(201).json(toIssue(row));
});

router.patch("/projects/:projectId/controls/issues/:issueId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateProjectIssueParams.safeParse({ projectId: req.params.projectId, issueId: req.params.issueId });
  const parsed = UpdateProjectIssueBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid issue update" }); return; }
  const [previous] = await db.select().from(projectIssuesTable).where(and(scope(req, projectIssuesTable), eq(projectIssuesTable.projectId, params.data.projectId), eq(projectIssuesTable.id, params.data.issueId)));
  if (!previous) { res.status(404).json({ error: "Issue not found" }); return; }
  const data = parsed.data;
  const [row] = await db.update(projectIssuesTable).set({
    ...data,
    ownerUserId: data.ownerUserId === undefined ? undefined : data.ownerUserId,
    dueDate: data.dueDate === undefined ? undefined : nullableDate(data.dueDate),
    costImpact: data.costImpact === undefined ? undefined : String(data.costImpact),
    updatedAt: new Date(),
    resolvedAt: data.status === "closed" ? new Date() : data.status ? null : undefined,
  }).where(and(scope(req, projectIssuesTable), eq(projectIssuesTable.projectId, params.data.projectId), eq(projectIssuesTable.id, params.data.issueId))).returning();
  await appendEvent(req, params.data.projectId, "issue", row.id, "issue_updated", undefined, previous.status, row.status);
  res.json(toIssue(row));
});

router.post("/projects/:projectId/controls/change-orders", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = CreateProjectChangeOrderParams.safeParse(req.params);
  const parsed = CreateProjectChangeOrderBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid change order" }); return; }
  if (!await getProject(req, params.data.projectId)) { res.status(404).json({ error: "Project not found" }); return; }
  const [row] = await db.insert(projectChangeOrdersTable).values({
    ...parsed.data,
    projectId: params.data.projectId,
    description: parsed.data.description ?? null,
    status: parsed.data.status ?? "draft",
    approvalStatus: parsed.data.approvalStatus ?? "pending",
    proposedValue: String(parsed.data.proposedValue),
    approvedValue: String(parsed.data.approvedValue ?? 0),
    scheduleImpactDays: parsed.data.scheduleImpactDays ?? 0,
    requestedBy: parsed.data.requestedBy ?? null,
    dueDate: nullableDate(parsed.data.dueDate),
    documentUrl: parsed.data.documentUrl ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await appendEvent(req, params.data.projectId, "change_order", row.id, "change_order_created", undefined, undefined, row.approvalStatus);
  res.status(201).json(toChangeOrder(row));
});

router.patch("/projects/:projectId/controls/change-orders/:changeOrderId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateProjectChangeOrderParams.safeParse({ projectId: req.params.projectId, changeOrderId: req.params.changeOrderId });
  const parsed = UpdateProjectChangeOrderBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid change order update" }); return; }
  const [previous] = await db.select().from(projectChangeOrdersTable).where(and(scope(req, projectChangeOrdersTable), eq(projectChangeOrdersTable.projectId, params.data.projectId), eq(projectChangeOrdersTable.id, params.data.changeOrderId)));
  if (!previous) { res.status(404).json({ error: "Change order not found" }); return; }
  const data = parsed.data;
  if (data.approvalStatus === "approved" && !canApproveProjectChange(await getCurrentTenantRole(req) as "owner" | "admin" | "member" | "platform_admin")) {
    res.status(403).json({ error: "Only customer administrators can approve a change order." });
    return;
  }
  const [row] = await db.update(projectChangeOrdersTable).set({
    ...data,
    description: data.description === undefined ? undefined : data.description,
    proposedValue: data.proposedValue === undefined ? undefined : String(data.proposedValue),
    approvedValue: data.approvedValue === undefined ? undefined : String(data.approvedValue),
    dueDate: data.dueDate === undefined ? undefined : nullableDate(data.dueDate),
    approvedAt: data.approvalStatus === "approved" ? new Date() : data.approvalStatus ? null : undefined,
    updatedAt: new Date(),
  }).where(and(scope(req, projectChangeOrdersTable), eq(projectChangeOrdersTable.projectId, params.data.projectId), eq(projectChangeOrdersTable.id, params.data.changeOrderId))).returning();
  await appendEvent(req, params.data.projectId, "change_order", row.id, "change_order_updated", undefined, previous.approvalStatus, row.approvalStatus);
  res.json(toChangeOrder(row));
});

router.put("/projects/:projectId/controls/financials", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateProjectFinancialsParams.safeParse(req.params);
  const parsed = UpdateProjectFinancialsBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid financial controls" }); return; }
  if (!await getProject(req, params.data.projectId)) { res.status(404).json({ error: "Project not found" }); return; }
  const data = parsed.data;
  const [row] = await db.insert(projectFinancialsTable).values({
    projectId: params.data.projectId,
    budgetCost: String(data.budgetCost),
    forecastCost: String(data.forecastCost),
    actualCost: String(data.actualCost),
    forecastRevenue: String(data.forecastRevenue),
    retainageHeld: String(data.retainageHeld ?? 0),
    asOfDate: nullableDate(data.asOfDate),
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).onConflictDoUpdate({
    target: [projectFinancialsTable.tenantId, projectFinancialsTable.environmentId, projectFinancialsTable.projectId],
    set: {
      budgetCost: String(data.budgetCost),
      forecastCost: String(data.forecastCost),
      actualCost: String(data.actualCost),
      forecastRevenue: String(data.forecastRevenue),
      retainageHeld: String(data.retainageHeld ?? 0),
      asOfDate: nullableDate(data.asOfDate),
      updatedAt: new Date(),
    },
  }).returning();
  await appendEvent(req, params.data.projectId, "financials", row.id, "financials_updated");
  res.json(toFinancials(row));
});

router.post("/projects/:projectId/controls/pay-applications", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = CreateProjectPayApplicationParams.safeParse(req.params);
  const parsed = CreateProjectPayApplicationBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid pay application" }); return; }
  if (!await getProject(req, params.data.projectId)) { res.status(404).json({ error: "Project not found" }); return; }
  const netAmount = Math.max(0, parsed.data.grossAmount - (parsed.data.retainageAmount ?? 0));
  const [row] = await db.insert(projectPayApplicationsTable).values({
    projectId: params.data.projectId,
    applicationNumber: parsed.data.applicationNumber,
    periodStart: nullableDate(parsed.data.periodStart),
    periodEnd: nullableDate(parsed.data.periodEnd),
    grossAmount: String(parsed.data.grossAmount),
    retainageAmount: String(parsed.data.retainageAmount ?? 0),
    netAmount: String(netAmount),
    status: parsed.data.status ?? "draft",
    submittedAt: parsed.data.status === "submitted" ? new Date() : null,
    notes: parsed.data.notes ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await appendEvent(req, params.data.projectId, "pay_application", row.id, "pay_application_created", undefined, undefined, row.status);
  res.status(201).json(toPayApplication(row));
});

router.patch("/projects/:projectId/controls/pay-applications/:applicationId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateProjectPayApplicationParams.safeParse(req.params);
  const parsed = UpdateProjectPayApplicationBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid pay application update" }); return; }
  const [previous] = await db.select().from(projectPayApplicationsTable).where(and(scope(req, projectPayApplicationsTable), eq(projectPayApplicationsTable.projectId, params.data.projectId), eq(projectPayApplicationsTable.id, params.data.applicationId)));
  if (!previous) { res.status(404).json({ error: "Pay application not found" }); return; }
  const data = parsed.data;
  const gross = data.grossAmount ?? money(previous.grossAmount);
  const retainage = data.retainageAmount ?? money(previous.retainageAmount);
  const [row] = await db.update(projectPayApplicationsTable).set({
    periodStart: data.periodStart === undefined ? undefined : nullableDate(data.periodStart),
    periodEnd: data.periodEnd === undefined ? undefined : nullableDate(data.periodEnd),
    grossAmount: data.grossAmount === undefined ? undefined : String(gross),
    retainageAmount: data.retainageAmount === undefined ? undefined : String(retainage),
    netAmount: String(Math.max(0, gross - retainage)),
    status: data.status,
    submittedAt: data.status === "submitted" && !previous.submittedAt ? new Date() : undefined,
    approvedAt: data.status === "approved" && !previous.approvedAt ? new Date() : undefined,
    paidAt: data.status === "paid" && !previous.paidAt ? new Date() : undefined,
    notes: data.notes === undefined ? undefined : data.notes,
    updatedAt: new Date(),
  }).where(and(scope(req, projectPayApplicationsTable), eq(projectPayApplicationsTable.projectId, params.data.projectId), eq(projectPayApplicationsTable.id, params.data.applicationId))).returning();
  await appendEvent(req, params.data.projectId, "pay_application", row.id, "pay_application_updated", undefined, previous.status, row.status);
  res.json(toPayApplication(row));
});

router.post("/projects/:projectId/controls/closeout-requirements", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = CreateProjectCloseoutRequirementParams.safeParse(req.params);
  const parsed = CreateProjectCloseoutRequirementBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid closeout requirement" }); return; }
  if (!await getProject(req, params.data.projectId)) { res.status(404).json({ error: "Project not found" }); return; }
  const [row] = await db.insert(projectCloseoutRequirementsTable).values({
    projectId: params.data.projectId,
    requirementNumber: parsed.data.requirementNumber,
    requirementType: parsed.data.requirementType ?? "document",
    title: parsed.data.title,
    status: parsed.data.status ?? "open",
    dueDate: nullableDate(parsed.data.dueDate),
    responsibleParty: parsed.data.responsibleParty ?? null,
    documentUrl: parsed.data.documentUrl ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  await appendEvent(req, params.data.projectId, "closeout_requirement", row.id, "closeout_requirement_created", undefined, undefined, row.status);
  res.status(201).json(row);
});

router.patch("/projects/:projectId/controls/closeout-requirements/:requirementId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateProjectCloseoutRequirementParams.safeParse(req.params);
  const parsed = UpdateProjectCloseoutRequirementBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "Invalid closeout requirement update" }); return; }
  const [previous] = await db.select().from(projectCloseoutRequirementsTable).where(and(scope(req, projectCloseoutRequirementsTable), eq(projectCloseoutRequirementsTable.projectId, params.data.projectId), eq(projectCloseoutRequirementsTable.id, params.data.requirementId)));
  if (!previous) { res.status(404).json({ error: "Closeout requirement not found" }); return; }
  const data = parsed.data;
  const [row] = await db.update(projectCloseoutRequirementsTable).set({
    title: data.title,
    status: data.status,
    dueDate: data.dueDate === undefined ? undefined : nullableDate(data.dueDate),
    responsibleParty: data.responsibleParty === undefined ? undefined : data.responsibleParty,
    documentUrl: data.documentUrl === undefined ? undefined : data.documentUrl,
    completedAt: ["complete", "waived"].includes(data.status ?? "") && !previous.completedAt ? new Date() : undefined,
    updatedAt: new Date(),
  }).where(and(scope(req, projectCloseoutRequirementsTable), eq(projectCloseoutRequirementsTable.projectId, params.data.projectId), eq(projectCloseoutRequirementsTable.id, params.data.requirementId))).returning();
  await appendEvent(req, params.data.projectId, "closeout_requirement", row.id, "closeout_requirement_updated", undefined, previous.status, row.status);
  res.json(row);
});

export default router;