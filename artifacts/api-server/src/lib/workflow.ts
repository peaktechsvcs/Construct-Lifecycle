import { and, asc, desc, eq } from "drizzle-orm";
import {
  db,
  workflowStatesTable,
  workflowStatusesTable,
  workflowTemplatesTable,
  workflowTransitionsTable,
  type WorkflowState,
  type WorkflowStatus,
  type WorkflowTemplate,
  type WorkflowTransition,
} from "@workspace/db";
import type { Project } from "@workspace/db";

export const DEFAULT_WORKFLOW_STATES = [
  { stableKey: "opportunity", displayName: "Opportunity", normalizedCategory: "PRE_SALES", terminal: false },
  { stableKey: "bid", displayName: "Bid", normalizedCategory: "PRE_SALES", terminal: false },
  { stableKey: "award", displayName: "Award", normalizedCategory: "AWARDED", terminal: false },
  { stableKey: "contract", displayName: "Contract", normalizedCategory: "CONTRACTED", terminal: false },
  { stableKey: "procure", displayName: "Procure", normalizedCategory: "PRE_CONSTRUCTION", terminal: false },
  { stableKey: "deliver", displayName: "Deliver", normalizedCategory: "EXECUTION", terminal: false },
  { stableKey: "financial", displayName: "Financial", normalizedCategory: "FINANCIAL", terminal: false },
  { stableKey: "closeout", displayName: "Closeout", normalizedCategory: "COMPLETED", terminal: true },
] as const;

export const DEFAULT_WORKFLOW_STATUSES = [
  { stableKey: "not_started", displayName: "Not started", stateKeys: [] },
  { stableKey: "active", displayName: "Active", stateKeys: [] },
  { stableKey: "waiting", displayName: "Waiting", stateKeys: [] },
  { stableKey: "complete", displayName: "Complete", stateKeys: ["closeout"] },
] as const;

export type WorkflowConfig = {
  template: WorkflowTemplate;
  states: WorkflowState[];
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
};

export type WorkflowConfigInput = {
  name?: string;
  description?: string | null;
  activeProjectStatusKeys?: string[];
  states: Array<{
    stableKey: string;
    displayName: string;
    description?: string | null;
    normalizedCategory: string;
    displayOrder: number;
    active?: boolean;
    terminal?: boolean;
    allowManualEnter?: boolean;
    allowManualLeave?: boolean;
    defaultStatusKey?: string | null;
    requiredFields?: string[];
  }>;
  statuses: Array<{
    stableKey: string;
    displayName: string;
    stateKeys?: string[];
    displayOrder: number;
    active?: boolean;
    required?: boolean;
  }>;
  transitions: Array<{
    fromStateKey: string;
    toStateKey: string;
    active?: boolean;
    requiresConfirmation?: boolean;
    allowedRoles?: string[];
    requiredFields?: string[];
    warningFields?: string[];
  }>;
};

export type WorkflowExecutor = Pick<typeof db, "select" | "insert">;

export async function readWorkflow(
  templateId: number,
  executor: WorkflowExecutor = db,
): Promise<WorkflowConfig | null> {
  const [template] = await executor.select().from(workflowTemplatesTable).where(eq(workflowTemplatesTable.id, templateId)).limit(1);
  if (!template) return null;
  const [states, statuses, transitions] = await Promise.all([
    executor.select().from(workflowStatesTable).where(eq(workflowStatesTable.workflowTemplateId, template.id)).orderBy(asc(workflowStatesTable.displayOrder)),
    executor.select().from(workflowStatusesTable).where(eq(workflowStatusesTable.workflowTemplateId, template.id)).orderBy(asc(workflowStatusesTable.displayOrder)),
    executor.select().from(workflowTransitionsTable).where(eq(workflowTransitionsTable.workflowTemplateId, template.id)).orderBy(asc(workflowTransitionsTable.fromStateKey)),
  ]);
  return { template, states, statuses, transitions };
}

export async function getPublishedWorkflow(
  tenantId: number,
  environmentId: number,
  executor: WorkflowExecutor = db,
) {
  const [template] = await executor.select().from(workflowTemplatesTable).where(and(
    eq(workflowTemplatesTable.tenantId, tenantId),
    eq(workflowTemplatesTable.environmentId, environmentId),
    eq(workflowTemplatesTable.status, "published"),
  )).orderBy(desc(workflowTemplatesTable.version), desc(workflowTemplatesTable.id)).limit(1);
  return template ? readWorkflow(template.id, executor) : null;
}

export async function getDraftWorkflow(
  tenantId: number,
  environmentId: number,
  executor: WorkflowExecutor = db,
) {
  const [template] = await executor.select().from(workflowTemplatesTable).where(and(
    eq(workflowTemplatesTable.tenantId, tenantId),
    eq(workflowTemplatesTable.environmentId, environmentId),
    eq(workflowTemplatesTable.status, "draft"),
  )).orderBy(desc(workflowTemplatesTable.version), desc(workflowTemplatesTable.id)).limit(1);
  return template ? readWorkflow(template.id, executor) : null;
}

export async function ensurePublishedWorkflow(
  tenantId: number,
  environmentId: number,
  userId?: number,
  executor: WorkflowExecutor = db,
) {
  const existing = await getPublishedWorkflow(tenantId, environmentId, executor);
  if (existing) return existing;

  const create = async (tx: WorkflowExecutor) => {
    const [template] = await tx.insert(workflowTemplatesTable).values({
      tenantId,
      environmentId,
      name: "Default Project Workflow",
      description: "Construct Lifecycle's starting project lifecycle.",
      activeProjectStatusKeys: ["active", "waiting"],
      status: "published",
      isDefault: true,
      version: 1,
      createdByUserId: userId ?? null,
      publishedByUserId: userId ?? null,
      publishedAt: new Date(),
    }).returning();

    await tx.insert(workflowStatesTable).values(DEFAULT_WORKFLOW_STATES.map((state, index) => ({
      workflowTemplateId: template.id,
      stableKey: state.stableKey,
      displayName: state.displayName,
      normalizedCategory: state.normalizedCategory,
      displayOrder: index,
      terminal: state.terminal,
      defaultStatusKey: state.stableKey === "closeout" ? "complete" : state.stableKey === "opportunity" ? "not_started" : "active",
    })));
    await tx.insert(workflowStatusesTable).values(DEFAULT_WORKFLOW_STATUSES.map((status, index) => ({
      workflowTemplateId: template.id,
      stableKey: status.stableKey,
      displayName: status.displayName,
      stateKeys: [...status.stateKeys],
      displayOrder: index,
    })));
    await tx.insert(workflowTransitionsTable).values(DEFAULT_WORKFLOW_STATES.slice(0, -1).map((state, index) => ({
      workflowTemplateId: template.id,
      fromStateKey: state.stableKey,
      toStateKey: DEFAULT_WORKFLOW_STATES[index + 1].stableKey,
      allowedRoles: ["owner", "admin", "member"],
    })));
    return template;
  };
  const created = executor === db ? await db.transaction(create) : await create(executor);
  return readWorkflow(created.id, executor === db ? db : executor);
}

export function validateWorkflowConfig(input: WorkflowConfigInput) {
  const errors: string[] = [];
  const activeStates = input.states.filter((state) => state.active !== false);
  const stateKeys = new Set(input.states.map((state) => state.stableKey));
  const statusKeys = new Set(input.statuses.map((status) => status.stableKey));
  const selectedStatusKeys = input.activeProjectStatusKeys ?? ["active", "waiting"];

  if (!input.states.length) errors.push("At least one lifecycle state is required.");
  if (!activeStates.some((state) => !input.transitions.some((transition) => transition.active !== false && transition.toStateKey === state.stableKey))) {
    errors.push("At least one active state must be a starting state.");
  }
  if (new Set(input.states.map((state) => state.displayOrder)).size !== input.states.length) errors.push("Lifecycle state display order values must be unique.");
  if (new Set(input.statuses.map((status) => status.displayOrder)).size !== input.statuses.length) errors.push("Status display order values must be unique.");
  if (!selectedStatusKeys.length) errors.push("Select at least one status for the Active Projects page.");
  for (const statusKey of selectedStatusKeys) {
    if (!statusKeys.has(statusKey)) errors.push(`Active Projects references a missing status: ${statusKey}`);
  }

  for (const state of input.states) {
    if (!/^[a-z][a-z0-9_]{1,62}$/.test(state.stableKey)) errors.push(`Invalid stable state key: ${state.stableKey}`);
    if (state.defaultStatusKey && !statusKeys.has(state.defaultStatusKey)) errors.push(`State ${state.displayName} references a missing default status.`);
  }
  for (const status of input.statuses) {
    if (!/^[a-z][a-z0-9_]{1,62}$/.test(status.stableKey)) errors.push(`Invalid stable status key: ${status.stableKey}`);
    for (const stateKey of status.stateKeys ?? []) if (!stateKeys.has(stateKey)) errors.push(`Status ${status.displayName} references a missing state.`);
  }
  for (const transition of input.transitions) {
    if (!stateKeys.has(transition.fromStateKey) || !stateKeys.has(transition.toStateKey)) errors.push(`Transition ${transition.fromStateKey} → ${transition.toStateKey} references a missing state.`);
    if (transition.fromStateKey === transition.toStateKey) errors.push("A workflow transition cannot point to the same state.");
  }
  if (new Set(input.transitions.map((transition) => `${transition.fromStateKey}:${transition.toStateKey}`)).size !== input.transitions.length) {
    errors.push("Workflow transitions must be unique.");
  }
  return errors;
}

export async function clonePublishedWorkflowToDraft(tenantId: number, environmentId: number, userId: number) {
  const currentDraft = await getDraftWorkflow(tenantId, environmentId);
  if (currentDraft) return currentDraft;
  const published = await ensurePublishedWorkflow(tenantId, environmentId, userId);
  if (!published) throw new Error("WORKFLOW_NOT_FOUND");

  const draft = await db.transaction(async (tx) => {
    const [template] = await tx.insert(workflowTemplatesTable).values({
      tenantId,
      environmentId,
      name: published.template.name,
      description: published.template.description,
      activeProjectStatusKeys: published.template.activeProjectStatusKeys,
      status: "draft",
      isDefault: published.template.isDefault,
      version: published.template.version + 1,
      createdByUserId: userId,
    }).returning();
    await tx.insert(workflowStatesTable).values(published.states.map(({ id: _id, workflowTemplateId: _templateId, createdAt: _createdAt, updatedAt: _updatedAt, ...state }) => ({ ...state, workflowTemplateId: template.id })));
    await tx.insert(workflowStatusesTable).values(published.statuses.map(({ id: _id, workflowTemplateId: _templateId, createdAt: _createdAt, updatedAt: _updatedAt, ...status }) => ({ ...status, workflowTemplateId: template.id })));
    await tx.insert(workflowTransitionsTable).values(published.transitions.map(({ id: _id, workflowTemplateId: _templateId, createdAt: _createdAt, updatedAt: _updatedAt, ...transition }) => ({ ...transition, workflowTemplateId: template.id })));
    return template;
  });
  return readWorkflow(draft.id);
}

export async function replaceDraftWorkflow(draftId: number, input: WorkflowConfigInput) {
  const errors = validateWorkflowConfig(input);
  if (errors.length) return { errors };
  await db.transaction(async (tx) => {
    await tx.update(workflowTemplatesTable).set({
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      activeProjectStatusKeys: input.activeProjectStatusKeys ?? ["active", "waiting"],
      updatedAt: new Date(),
    }).where(eq(workflowTemplatesTable.id, draftId));
    await tx.delete(workflowStatesTable).where(eq(workflowStatesTable.workflowTemplateId, draftId));
    await tx.delete(workflowStatusesTable).where(eq(workflowStatusesTable.workflowTemplateId, draftId));
    await tx.delete(workflowTransitionsTable).where(eq(workflowTransitionsTable.workflowTemplateId, draftId));
    await tx.insert(workflowStatesTable).values(input.states.map((state) => ({
      workflowTemplateId: draftId,
      stableKey: state.stableKey,
      displayName: state.displayName.trim(),
      description: state.description?.trim() || null,
      normalizedCategory: state.normalizedCategory,
      displayOrder: state.displayOrder,
      active: state.active !== false,
      terminal: state.terminal === true,
      allowManualEnter: state.allowManualEnter !== false,
      allowManualLeave: state.allowManualLeave !== false,
      defaultStatusKey: state.defaultStatusKey ?? null,
      requiredFields: state.requiredFields ?? [],
    })));
    await tx.insert(workflowStatusesTable).values(input.statuses.map((status) => ({
      workflowTemplateId: draftId,
      stableKey: status.stableKey,
      displayName: status.displayName.trim(),
      stateKeys: status.stateKeys ?? [],
      displayOrder: status.displayOrder,
      active: status.active !== false,
      required: status.required === true,
    })));
    if (input.transitions.length) await tx.insert(workflowTransitionsTable).values(input.transitions.map((transition) => ({
      workflowTemplateId: draftId,
      fromStateKey: transition.fromStateKey,
      toStateKey: transition.toStateKey,
      active: transition.active !== false,
      requiresConfirmation: transition.requiresConfirmation === true,
      allowedRoles: transition.allowedRoles ?? [],
      requiredFields: transition.requiredFields ?? [],
      warningFields: transition.warningFields ?? [],
    })));
  });
  return { errors: [] as string[] };
}

export async function publishDraftWorkflow(draftId: number, userId: number) {
  const draft = await readWorkflow(draftId);
  if (!draft) throw new Error("WORKFLOW_NOT_FOUND");
  const errors = validateWorkflowConfig({
    name: draft.template.name,
    description: draft.template.description,
    states: draft.states,
    statuses: draft.statuses,
    transitions: draft.transitions,
  });
  if (errors.length) return { errors };
  await db.update(workflowTemplatesTable).set({
    status: "published",
    publishedByUserId: userId,
    publishedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(workflowTemplatesTable.id, draftId));
  return { errors: [] as string[] };
}

function hasProjectValue(project: Partial<Project>, field: string) {
  const value = (project as Record<string, unknown>)[field];
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return value.trim().length > 0 && value !== "0";
  return value !== null && value !== undefined;
}

export function validateProjectTransition(
  workflow: WorkflowConfig,
  currentStateKey: string,
  nextStateKey: string,
  role: string,
  project: Partial<Project>,
) {
  const transition = workflow.transitions.find((item) =>
    item.active && item.fromStateKey === currentStateKey && item.toStateKey === nextStateKey,
  );
  if (!transition) return { transition: null, error: `This workflow does not allow ${currentStateKey} → ${nextStateKey}.` };
  if (transition.allowedRoles.length && !transition.allowedRoles.includes(role)) {
    return { transition, error: "Your role does not have permission to make this transition." };
  }
  const missing = transition.requiredFields.filter((field) => !hasProjectValue(project, field));
  if (missing.length) return { transition, error: `Required before moving to ${nextStateKey}: ${missing.join(", ")}.` };
  return {
    transition,
    warnings: transition.warningFields.filter((field) => !hasProjectValue(project, field)),
  };
}