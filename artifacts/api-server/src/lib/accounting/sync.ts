import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  integrationAuditEventsTable,
  integrationEntitlementsTable,
  integrationsTable,
  projectAccountingSyncsTable,
  projectCommitmentsTable,
  projectControlEventsTable,
  projectFinancialsTable,
  projectPayApplicationsTable,
  projectsTable,
} from "@workspace/db";
import type { TenantRequest } from "../../middlewares/tenantContext";
import { getConnectorDefinition } from "../integrations/catalog";
import { tenantHasEffectiveEntitlement } from "../billing-access";
import {
  markIntegrationJobFailed,
  markIntegrationJobSucceeded,
  startIntegrationJob,
} from "../integrations/job-lifecycle";
import { registerQuickBooksAccountingProvider } from "./quickbooks";
import { getAccountingProvider, registerAccountingProvider, type AccountingProviderContext } from "./provider";

const connectors = new ReplitConnectors();
registerQuickBooksAccountingProvider(connectors, registerAccountingProvider);

const money = (value: string | number | null | undefined) => Number(value ?? 0);

const parseObject = (value: string | null | undefined): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const safeError = (error: unknown) =>
  (error instanceof Error ? error.message : "Accounting provider request failed").replace(/[\r\n]/g, " ").slice(0, 240);

export class AccountingSyncError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 409,
  ) {
    super(message);
    this.name = "AccountingSyncError";
  }
}

const getSelectedProvider = async (req: TenantRequest, providerKey: string) => {
  const definition = getConnectorDefinition(providerKey);
  if (!definition || definition.category !== "accounting") {
    throw new AccountingSyncError("The selected accounting provider is not available.", 404);
  }
  const provider = getAccountingProvider(providerKey);
  if (!provider || !provider.capabilities.has("sync_approved_pay_application") || !provider.capabilities.has("sync_project_cost_status")) {
    throw new AccountingSyncError("The selected accounting provider is not available.", 409);
  }
  if (!await tenantHasEffectiveEntitlement(req.tenantId!, definition.entitlementKey)) {
    throw new AccountingSyncError("The selected accounting provider is not entitled for this subscription.", 403);
  }
  const [entitlement] = await db.select({ id: integrationEntitlementsTable.id }).from(integrationEntitlementsTable).where(and(
    eq(integrationEntitlementsTable.tenantId, req.tenantId!),
    eq(integrationEntitlementsTable.capabilityKey, definition.entitlementKey),
    eq(integrationEntitlementsTable.enabled, true),
  )).limit(1);
  if (!entitlement) {
    throw new AccountingSyncError("The selected accounting provider is not entitled for this customer.", 403);
  }
  const [integration] = await db.select().from(integrationsTable).where(and(
    eq(integrationsTable.tenantId, req.tenantId!),
    eq(integrationsTable.environmentId, req.environmentId!),
    eq(integrationsTable.providerKey, providerKey),
  )).limit(1);
  if (!integration || ["not_connected", "disconnected", "failed", "invalid", "revoked", "expired"].includes(integration.status)) {
    throw new AccountingSyncError("The selected accounting provider is not connected for this environment.", 409);
  }
  return {
    definition,
    provider,
    integration,
    context: {
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      integrationId: integration.id,
      configuration: parseObject(integration.configuration),
    } satisfies AccountingProviderContext,
  };
};

const syncRecord = async (
  req: TenantRequest,
  projectId: number,
  providerKey: string,
  integrationId: number,
  resourceType: string,
  resourceKey: string,
) => {
  const [existing] = await db.select().from(projectAccountingSyncsTable).where(and(
    eq(projectAccountingSyncsTable.projectId, projectId),
    eq(projectAccountingSyncsTable.resourceType, resourceType),
    eq(projectAccountingSyncsTable.resourceKey, resourceKey),
    eq(projectAccountingSyncsTable.providerKey, providerKey),
    eq(projectAccountingSyncsTable.tenantId, req.tenantId!),
    eq(projectAccountingSyncsTable.environmentId, req.environmentId!),
  )).limit(1);
  if (existing?.syncStatus === "synced" && existing.externalId) return { record: existing, claimed: false };
  if (existing?.syncStatus === "syncing") return { record: existing, claimed: false };

  const now = new Date();
  const [inserted] = await db.insert(projectAccountingSyncsTable).values({
    projectId,
    resourceType,
    resourceKey,
    providerKey,
    integrationId,
    syncStatus: "syncing",
    lastAttemptedAt: now,
    lastError: null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).onConflictDoNothing({
    target: [
      projectAccountingSyncsTable.tenantId,
      projectAccountingSyncsTable.environmentId,
      projectAccountingSyncsTable.projectId,
      projectAccountingSyncsTable.resourceType,
      projectAccountingSyncsTable.resourceKey,
      projectAccountingSyncsTable.providerKey,
    ],
  }).returning();
  if (inserted) return { record: inserted, claimed: true };

  const [current] = existing
    ? [existing]
    : await db.select().from(projectAccountingSyncsTable).where(and(
      eq(projectAccountingSyncsTable.projectId, projectId),
      eq(projectAccountingSyncsTable.resourceType, resourceType),
      eq(projectAccountingSyncsTable.resourceKey, resourceKey),
      eq(projectAccountingSyncsTable.providerKey, providerKey),
      eq(projectAccountingSyncsTable.tenantId, req.tenantId!),
      eq(projectAccountingSyncsTable.environmentId, req.environmentId!),
    )).limit(1);
  if (!current) throw new AccountingSyncError("Accounting sync could not claim the requested resource.", 409);
  const [claim] = await db.update(projectAccountingSyncsTable).set({
    integrationId,
    syncStatus: "syncing",
    lastAttemptedAt: now,
    lastError: null,
    updatedAt: now,
  }).where(and(
    eq(projectAccountingSyncsTable.id, current.id),
    inArray(projectAccountingSyncsTable.syncStatus, ["failed", "not_synced"]),
  )).returning();
  return { record: claim ?? current, claimed: Boolean(claim) };
};

export async function syncProjectAccounting(req: TenantRequest, projectId: number, providerKey: string) {
  const selected = await getSelectedProvider(req, providerKey);
  const [project] = await db.select().from(projectsTable).where(and(
    eq(projectsTable.id, projectId),
    eq(projectsTable.tenantId, req.tenantId!),
    eq(projectsTable.environmentId, req.environmentId!),
  ));
  if (!project) throw new AccountingSyncError("Project not found.", 404);

  const [financials] = await db.select().from(projectFinancialsTable).where(and(
    eq(projectFinancialsTable.projectId, projectId),
    eq(projectFinancialsTable.tenantId, req.tenantId!),
    eq(projectFinancialsTable.environmentId, req.environmentId!),
  )).limit(1);
  const commitments = await db.select().from(projectCommitmentsTable).where(and(
    eq(projectCommitmentsTable.projectId, projectId),
    eq(projectCommitmentsTable.tenantId, req.tenantId!),
    eq(projectCommitmentsTable.environmentId, req.environmentId!),
  ));
  const approvedApplications = await db.select().from(projectPayApplicationsTable).where(and(
    eq(projectPayApplicationsTable.projectId, projectId),
    eq(projectPayApplicationsTable.tenantId, req.tenantId!),
    eq(projectPayApplicationsTable.environmentId, req.environmentId!),
    inArray(projectPayApplicationsTable.status, ["approved", "paid"]),
  ));
  const committedCost = commitments.reduce((sum, row) => sum + money(row.committedValue), 0);
  const asOfDate = financials?.asOfDate ?? new Date().toISOString().slice(0, 10);
  const jobStartedAt = new Date();
  const job = await startIntegrationJob({
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
    integrationId: selected.integration.id,
    providerKey,
  }, "project_accounting_sync");

  const context = selected.context;
  const successful: Array<{ resourceType: string; resourceKey: string; externalId: string }> = [];
  const failed: Array<{ resourceType: string; resourceKey: string; error: string }> = [];

  const runResource = async (
    resourceType: string,
    resourceKey: string,
    run: () => Promise<{ externalId: string; metadata?: Record<string, unknown> }>,
  ) => {
    const attempt = await syncRecord(req, projectId, providerKey, selected.integration.id, resourceType, resourceKey);
    if (!attempt.claimed && attempt.record.syncStatus === "synced" && attempt.record.externalId) {
      successful.push({ resourceType, resourceKey, externalId: attempt.record.externalId });
      return;
    }
    if (!attempt.claimed) {
      failed.push({ resourceType, resourceKey, error: "Accounting provider sync is already in progress" });
      return;
    }
    try {
      const result = await run();
      await db.update(projectAccountingSyncsTable).set({
        syncStatus: "synced",
        externalId: result.externalId,
        lastSuccessfulSyncAt: new Date(),
        lastError: null,
        metadata: JSON.stringify(result.metadata ?? {}),
        updatedAt: new Date(),
      }).where(and(
        eq(projectAccountingSyncsTable.projectId, projectId),
        eq(projectAccountingSyncsTable.resourceType, resourceType),
        eq(projectAccountingSyncsTable.resourceKey, resourceKey),
        eq(projectAccountingSyncsTable.providerKey, providerKey),
        eq(projectAccountingSyncsTable.tenantId, req.tenantId!),
        eq(projectAccountingSyncsTable.environmentId, req.environmentId!),
      ));
      successful.push({ resourceType, resourceKey, externalId: result.externalId });
    } catch (error) {
      const message = safeError(error);
      await db.update(projectAccountingSyncsTable).set({
        syncStatus: "failed",
        lastError: message,
        updatedAt: new Date(),
      }).where(and(
        eq(projectAccountingSyncsTable.projectId, projectId),
        eq(projectAccountingSyncsTable.resourceType, resourceType),
        eq(projectAccountingSyncsTable.resourceKey, resourceKey),
        eq(projectAccountingSyncsTable.providerKey, providerKey),
        eq(projectAccountingSyncsTable.tenantId, req.tenantId!),
        eq(projectAccountingSyncsTable.environmentId, req.environmentId!),
      ));
      failed.push({ resourceType, resourceKey, error: "Accounting provider sync failed" });
      req.log.warn({ projectId, providerKey, resourceType, resourceKey }, "Project accounting resource sync failed");
    }
  };

  await runResource("cost_status", "project", () => selected.provider.syncProjectCostStatus(context, {
    projectId,
    projectNumber: project.projectNumber,
    projectName: project.projectName,
    customerName: project.customerName,
    budgetCost: money(financials?.budgetCost),
    committedCost,
    forecastCost: financials?.forecastCost == null ? committedCost : money(financials.forecastCost),
    actualCost: money(financials?.actualCost),
    forecastRevenue: financials?.forecastRevenue == null ? money(project.contractValue) : money(financials.forecastRevenue),
    asOfDate,
    currencyCode: "USD",
  }));

  for (const application of approvedApplications) {
    await runResource("pay_application", String(application.id), () => selected.provider.syncApprovedPayApplication(context, {
      projectId,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      customerName: project.customerName,
      applicationId: application.id,
      applicationNumber: application.applicationNumber,
      approvedAt: application.approvedAt ?? application.updatedAt,
      grossAmount: money(application.grossAmount),
      retainageAmount: money(application.retainageAmount),
      netAmount: money(application.netAmount),
      currencyCode: "USD",
    }));
  }

  const overallStatus = failed.length === 0 ? "success" : successful.length > 0 ? "partial" : "failed";
  const finishedJob = failed.length === 0
    ? await markIntegrationJobSucceeded({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      integrationId: selected.integration.id,
      providerKey,
    }, job)
    : await markIntegrationJobFailed({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      integrationId: selected.integration.id,
      providerKey,
    }, job, "One or more accounting resources could not be synchronized", { retryable: false });
  const completedAt = finishedJob.completedAt ?? new Date();
  await db.insert(integrationAuditEventsTable).values({
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
    integrationId: selected.integration.id,
    providerKey,
    action: failed.length === 0 ? "project_accounting_sync_succeeded" : "project_accounting_sync_failed",
    details: JSON.stringify({
      projectId,
      successfulCount: successful.length,
      failedCount: failed.length,
    }),
    actorUserId: req.localUserId!,
  });
  await db.insert(projectControlEventsTable).values({
    projectId,
    entityType: "accounting_sync",
    entityId: job.id,
    action: "accounting_sync_completed",
    details: JSON.stringify({
      providerKey,
      status: overallStatus,
      successfulCount: successful.length,
      failedCount: failed.length,
    }),
    actorUserId: req.localUserId ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  });

  const syncs = await db.select().from(projectAccountingSyncsTable).where(and(
    eq(projectAccountingSyncsTable.projectId, projectId),
    eq(projectAccountingSyncsTable.providerKey, providerKey),
    eq(projectAccountingSyncsTable.tenantId, req.tenantId!),
    eq(projectAccountingSyncsTable.environmentId, req.environmentId!),
  ));
  return {
    projectId,
    providerKey,
    status: overallStatus,
    startedAt: jobStartedAt,
    completedAt,
    successful,
    failed,
    syncs: syncs.map((sync) => ({
      ...sync,
      metadata: parseObject(sync.metadata),
    })),
  };
}