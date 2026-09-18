import { Router, type IRouter } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  integrationAuditEventsTable,
  integrationEntitlementsTable,
  integrationJobsTable,
  integrationsTable,
} from "@workspace/db";
import {
  ListIntegrationActivityQueryParams,
  ListIntegrationActivityResponse,
  ListIntegrationsResponse,
  ConnectIntegrationParams,
  ConnectIntegrationResponse,
  RevokeIntegrationParams,
  RevokeIntegrationResponse,
  ListIntegrationJobsQueryParams,
  ListIntegrationJobsResponse,
  RetryIntegrationJobParams,
  ReviewIntegrationJobParams,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import { connectorCatalog, getConnectorDefinition } from "../lib/integrations/catalog";
import {
  defaultItbMailboxMonitorConfig,
  mailboxProviderFromIntegrationKey,
  parseItbMailboxMonitorConfig,
  withItbMailboxMonitorConfig,
} from "../lib/itb-mailbox-monitor-config";
import {
  managedCredentialsReference,
  selectManagedConnection,
  summarizeIntegrationHealth,
} from "../lib/integrations/managed-connection";
import {
  effectiveEntitlementEnabled,
  getEffectiveFeatureAccess,
  tenantHasEffectiveEntitlement,
} from "../lib/billing-access";

const router: IRouter = Router();
const connectors = new ReplitConnectors();
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const manualJobActionLimits = {
  retry: { action: "job_retry_requested", limit: 3, windowMs: 10 * 60 * 1000 },
  review: { action: "job_reviewed", limit: 30, windowMs: 10 * 60 * 1000 },
} as const;

const serializeConnection = (
  connection: typeof integrationsTable.$inferSelect,
  jobs: Array<typeof integrationJobsTable.$inferSelect> = [],
) => {
  const health = summarizeIntegrationHealth(connection, jobs);
  return {
  id: connection.id,
  status: connection.status,
  connectionType: connection.connectionType,
  healthStatus: health.healthStatus,
  lastSyncAt: connection.lastSyncAt,
  lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
  lastSyncStatus: connection.lastSyncStatus,
  lastFailureAt: health.lastFailureAt,
  lastError: health.lastError,
  retryCount: health.retryCount,
  deadLetterCount: health.deadLetterCount,
  nextRetryAt: health.nextRetryAt,
  };
};

const entitledConnector = async (tenantId: number, providerKey: string) => {
  const definition = getConnectorDefinition(providerKey);
  if (!definition) return null;
  if (!await tenantHasEffectiveEntitlement(tenantId, definition.entitlementKey)) return null;
  const [entitlement] = await db.select({ id: integrationEntitlementsTable.id })
    .from(integrationEntitlementsTable)
    .where(and(
      eq(integrationEntitlementsTable.tenantId, tenantId),
      eq(integrationEntitlementsTable.capabilityKey, definition.entitlementKey),
      eq(integrationEntitlementsTable.enabled, true),
    ))
    .limit(1);
  return entitlement ? definition : null;
};

const recordConnectionFailure = async (
  req: TenantRequest,
  providerKey: string,
  reason: string,
  integrationId?: number,
) => {
  await db.insert(integrationAuditEventsTable).values({
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
    integrationId,
    providerKey,
    action: "connection_failed",
    details: JSON.stringify({ reason }),
    actorUserId: req.localUserId!,
  });
};

const parseJson = (value: string | null | undefined): Record<string, unknown> => {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const serializeJob = (job: typeof integrationJobsTable.$inferSelect) => ({
  id: job.id,
  providerKey: job.providerKey,
  jobType: job.jobType,
  status: job.status,
  attempts: job.attempts,
  maxAttempts: job.maxAttempts,
  nextRetryAt: job.nextRetryAt,
  lastError: job.lastError,
  deadLetteredAt: job.deadLetteredAt,
  completedAt: job.completedAt,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const getScopedJob = async (req: TenantRequest, jobId: number) => {
  const [job] = await db.select().from(integrationJobsTable).where(and(
    eq(integrationJobsTable.id, jobId),
    eq(integrationJobsTable.tenantId, req.tenantId!),
    eq(integrationJobsTable.environmentId, req.environmentId!),
  )).limit(1);
  if (!job) return null;
  const definition = await entitledConnector(req.tenantId!, job.providerKey);
  return definition ? job : null;
};

const manualActionRateLimit = async (
  tx: DatabaseTransaction,
  req: TenantRequest,
  action: keyof typeof manualJobActionLimits,
) => {
  const policy = manualJobActionLimits[action];
  const windowStartedAt = new Date(Date.now() - policy.windowMs);
  const [{ actionCount }] = await tx.select({ actionCount: count() })
    .from(integrationAuditEventsTable)
    .where(and(
      eq(integrationAuditEventsTable.tenantId, req.tenantId!),
      eq(integrationAuditEventsTable.environmentId, req.environmentId!),
      eq(integrationAuditEventsTable.actorUserId, req.localUserId!),
      eq(integrationAuditEventsTable.action, policy.action),
      gte(integrationAuditEventsTable.createdAt, windowStartedAt),
    ));
  const currentCount = Number(actionCount);
  if (currentCount < policy.limit) return null;
  return Math.max(1, Math.ceil((windowStartedAt.getTime() + policy.windowMs - Date.now()) / 1000));
};

const actionLockKey = (req: TenantRequest, action: keyof typeof manualJobActionLimits) =>
  `integration-job:${action}:${req.tenantId}:${req.environmentId}:${req.localUserId}`;

async function mutateJob(
  req: TenantRequest,
  jobId: number,
  action: keyof typeof manualJobActionLimits,
) {
  const job = await getScopedJob(req, jobId);
  if (!job) return { kind: "missing" as const };

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actionLockKey(req, action)}))`);
    const retryAfterSeconds = await manualActionRateLimit(tx, req, action);
    if (retryAfterSeconds) return { kind: "rate_limited" as const, retryAfterSeconds };

    const eligibleStatuses = action === "retry" ? ["retry", "dead_letter"] : ["dead_letter"];
    const [updated] = await tx.update(integrationJobsTable).set(
      action === "retry"
        ? {
            status: "queued",
            attempts: 0,
            nextRetryAt: new Date(),
            deadLetteredAt: null,
            completedAt: null,
            updatedAt: new Date(),
          }
        : {
            status: "reviewed",
            nextRetryAt: null,
            updatedAt: new Date(),
          },
    ).where(and(
      eq(integrationJobsTable.id, jobId),
      eq(integrationJobsTable.tenantId, req.tenantId!),
      eq(integrationJobsTable.environmentId, req.environmentId!),
      inArray(integrationJobsTable.status, eligibleStatuses),
    )).returning();

    if (!updated) return { kind: "ineligible" as const };
    await tx.insert(integrationAuditEventsTable).values({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      integrationId: updated.integrationId,
      providerKey: updated.providerKey,
      action: manualJobActionLimits[action].action,
      details: JSON.stringify({
        jobId: updated.id,
        jobType: updated.jobType,
        previousStatus: job.status,
        previousAttempts: job.attempts,
        maxAttempts: job.maxAttempts,
      }),
      actorUserId: req.localUserId!,
    });
    return { kind: "updated" as const, job: updated };
  });
}

router.get("/integrations", requireRole("owner", "admin"), async (req: TenantRequest, res): Promise<void> => {
  const [effectiveAccess, entitlements, connections, latestActivity, jobs] = await Promise.all([
    getEffectiveFeatureAccess(req.tenantId!),
    db.select().from(integrationEntitlementsTable)
      .where(and(eq(integrationEntitlementsTable.tenantId, req.tenantId!), eq(integrationEntitlementsTable.enabled, true))),
    db.select().from(integrationsTable)
      .where(and(eq(integrationsTable.tenantId, req.tenantId!), eq(integrationsTable.environmentId, req.environmentId!))),
    db.select({
      providerKey: integrationAuditEventsTable.providerKey,
      lastActivityAt: sql<Date>`max(${integrationAuditEventsTable.createdAt})`,
      activityCount: sql<number>`count(*)::int`,
    }).from(integrationAuditEventsTable)
      .where(and(eq(integrationAuditEventsTable.tenantId, req.tenantId!), eq(integrationAuditEventsTable.environmentId, req.environmentId!)))
      .groupBy(integrationAuditEventsTable.providerKey),
    db.select().from(integrationJobsTable)
      .where(and(
        eq(integrationJobsTable.tenantId, req.tenantId!),
        eq(integrationJobsTable.environmentId, req.environmentId!),
      )),
  ]);

  const entitlementKeys = new Set(entitlements.map((entitlement) => entitlement.capabilityKey));
  const connectionByProvider = new Map(connections.map((connection) => [connection.providerKey, connection]));
  const activityByProvider = new Map(latestActivity.map((activity) => [activity.providerKey, activity]));
  const jobsByProvider = new Map<string, Array<typeof integrationJobsTable.$inferSelect>>();
  for (const job of jobs) {
    const providerJobs = jobsByProvider.get(job.providerKey) ?? [];
    providerJobs.push(job);
    jobsByProvider.set(job.providerKey, providerJobs);
  }

  const response = connectorCatalog
    .filter((connector) =>
      entitlementKeys.has(connector.entitlementKey)
      && effectiveEntitlementEnabled(effectiveAccess, connector.entitlementKey),
    )
    .map((connector) => {
      const connection = connectionByProvider.get(connector.providerKey);
      const activity = activityByProvider.get(connector.providerKey);
      const providerJobs = jobsByProvider.get(connector.providerKey) ?? [];
      const health = connection ? summarizeIntegrationHealth(connection, providerJobs) : null;
      return {
        providerKey: connector.providerKey,
        name: connector.name,
        category: connector.category,
        categoryLabel: connector.categoryLabel,
        description: connector.description,
        capabilities: connector.capabilities,
        connectorStatus: connector.connectorStatus,
        entitlement: "enabled" as const,
        supportsConnection: Boolean(connector.managedConnectorName),
        state: !connection
          ? "cataloged" as const
          : health?.healthStatus === "degraded" || health?.healthStatus === "failed" || health?.healthStatus === "disabled"
            ? "degraded" as const
            : "connected" as const,
        connection: connection ? serializeConnection(connection, providerJobs) : null,
        activity: activity ? {
          lastActivityAt: activity.lastActivityAt,
          activityCount: activity.activityCount,
        } : {
          lastActivityAt: null,
          activityCount: 0,
        },
      };
    });

  res.json(ListIntegrationsResponse.parse(response));
});

router.post("/integrations/:providerKey/connect", requireRole("owner", "admin"), async (req: TenantRequest, res): Promise<void> => {
  const params = ConnectIntegrationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid integration provider" });
    return;
  }
  const definition = await entitledConnector(req.tenantId!, params.data.providerKey);
  if (!definition) {
    res.status(404).json({ error: "Integration provider not available" });
    return;
  }
  if (!definition.managedConnectorName) {
    res.status(409).json({ error: "This provider is not available for managed connection yet" });
    return;
  }

  let managed;
  try {
    const available = await connectors.listConnections({
      connector_names: definition.managedConnectorName,
      refresh_policy: "force",
    });
    managed = selectManagedConnection(available);
  } catch (error) {
    req.log?.warn({ err: error, providerKey: definition.providerKey }, "managed connector lookup failed");
    await recordConnectionFailure(req, definition.providerKey, "connector_unavailable");
    res.status(424).json({ error: `${definition.name} authorization is unavailable. Authorize the managed connector and try again.` });
    return;
  }

  if (managed.kind === "missing") {
    await recordConnectionFailure(req, definition.providerKey, "authorization_required");
    res.status(424).json({ error: `${definition.name} must be authorized through the managed connector before it can be attached.` });
    return;
  }
  if (managed.kind === "ambiguous") {
    await recordConnectionFailure(req, definition.providerKey, "multiple_authorizations");
    res.status(409).json({ error: `Multiple ${definition.name} authorizations are available. Keep one active authorization and try again.` });
    return;
  }

  const credentialsReference = managedCredentialsReference(
    definition.managedConnectorName,
    managed.connection.id,
  );
  const [claimed] = await db.select({
    id: integrationsTable.id,
    tenantId: integrationsTable.tenantId,
    environmentId: integrationsTable.environmentId,
    providerKey: integrationsTable.providerKey,
  }).from(integrationsTable)
    .where(eq(integrationsTable.credentialsReference, credentialsReference))
    .limit(1);
  if (
    claimed
    && (
      claimed.tenantId !== req.tenantId
      || claimed.environmentId !== req.environmentId
      || claimed.providerKey !== definition.providerKey
    )
  ) {
    await recordConnectionFailure(req, definition.providerKey, "authorization_already_attached");
    res.status(409).json({ error: "This managed authorization is already attached to another customer environment." });
    return;
  }

  try {
    const [existing] = await db.select().from(integrationsTable).where(and(
      eq(integrationsTable.tenantId, req.tenantId!),
      eq(integrationsTable.environmentId, req.environmentId!),
      eq(integrationsTable.providerKey, definition.providerKey),
    )).limit(1);
    const action = existing?.status === "connected" && existing.credentialsReference === credentialsReference
      ? "connection_confirmed"
      : existing
        ? "reconnected"
        : "connected";
    const mailboxProvider = mailboxProviderFromIntegrationKey(definition.providerKey);
    const connectorConfiguration = JSON.stringify({ connectorName: definition.managedConnectorName });
    const configuration = mailboxProvider
      ? withItbMailboxMonitorConfig(
        connectorConfiguration,
        mailboxProvider,
        existing ? parseItbMailboxMonitorConfig(existing.configuration, mailboxProvider) : defaultItbMailboxMonitorConfig(mailboxProvider),
      )
      : connectorConfiguration;
    const connected = await db.transaction(async (tx) => {
      const [row] = await tx.insert(integrationsTable).values({
        tenantId: req.tenantId!,
        environmentId: req.environmentId!,
        providerKey: definition.providerKey,
        providerCategory: definition.category,
        status: "connected",
        connectionType: "replit_managed_oauth",
        configuration,
        credentialsReference,
        lastError: null,
      }).onConflictDoUpdate({
        target: [
          integrationsTable.tenantId,
          integrationsTable.environmentId,
          integrationsTable.providerKey,
        ],
        set: {
          providerCategory: definition.category,
          status: "connected",
          connectionType: "replit_managed_oauth",
          configuration,
          credentialsReference,
          lastError: null,
          updatedAt: new Date(),
        },
      }).returning();
      await tx.insert(integrationAuditEventsTable).values({
        tenantId: req.tenantId!,
        environmentId: req.environmentId!,
        integrationId: row.id,
        providerKey: definition.providerKey,
        action,
        details: JSON.stringify({
          connectionType: "replit_managed_oauth",
          connectorName: definition.managedConnectorName,
        }),
        actorUserId: req.localUserId!,
      });
      return row;
    });
    res.json(ConnectIntegrationResponse.parse(serializeConnection(connected)));
  } catch (error) {
    req.log?.warn({ err: error, providerKey: definition.providerKey }, "managed connector attachment failed");
    await recordConnectionFailure(req, definition.providerKey, "authorization_conflict");
    res.status(409).json({ error: "This managed authorization could not be attached to the active customer environment." });
  }
});

router.post("/integrations/:providerKey/revoke", requireRole("owner", "admin"), async (req: TenantRequest, res): Promise<void> => {
  const params = RevokeIntegrationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid integration provider" });
    return;
  }
  const definition = await entitledConnector(req.tenantId!, params.data.providerKey);
  if (!definition) {
    res.status(404).json({ error: "Integration provider not available" });
    return;
  }
  const [existing] = await db.select().from(integrationsTable).where(and(
    eq(integrationsTable.tenantId, req.tenantId!),
    eq(integrationsTable.environmentId, req.environmentId!),
    eq(integrationsTable.providerKey, definition.providerKey),
  )).limit(1);
  if (!existing || existing.status !== "connected") {
    res.status(404).json({ error: "Connected integration not found" });
    return;
  }

  const revoked = await db.transaction(async (tx) => {
    const [row] = await tx.update(integrationsTable).set({
      status: "not_connected",
      connectionType: "not_configured",
      configuration: "{}",
      credentialsReference: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastError: null,
      updatedAt: new Date(),
    }).where(and(
      eq(integrationsTable.id, existing.id),
      eq(integrationsTable.tenantId, req.tenantId!),
      eq(integrationsTable.environmentId, req.environmentId!),
    )).returning();
    await tx.insert(integrationAuditEventsTable).values({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      integrationId: row.id,
      providerKey: definition.providerKey,
      action: "revoked",
      details: JSON.stringify({ connectionType: existing.connectionType }),
      actorUserId: req.localUserId!,
    });
    return row;
  });
  res.json(RevokeIntegrationResponse.parse(serializeConnection(revoked)));
});

router.get("/integrations/activity", requireRole("owner", "admin"), async (req: TenantRequest, res): Promise<void> => {
  const query = ListIntegrationActivityQueryParams.safeParse(req.query);
  const definition = query.success ? getConnectorDefinition(query.data.providerKey) : undefined;
  if (!query.success || !definition) {
    res.status(404).json({ error: "Integration provider not found" });
    return;
  }

  if (!await entitledConnector(req.tenantId!, definition.providerKey)) {
    res.status(404).json({ error: "Integration provider not available" });
    return;
  }

  const activity = await db.select().from(integrationAuditEventsTable)
    .where(and(
      eq(integrationAuditEventsTable.tenantId, req.tenantId!),
      eq(integrationAuditEventsTable.environmentId, req.environmentId!),
      eq(integrationAuditEventsTable.providerKey, query.data.providerKey),
    ))
    .orderBy(desc(integrationAuditEventsTable.createdAt))
    .limit(query.data.limit);

  res.json(ListIntegrationActivityResponse.parse(activity.map((event) => ({
    id: event.id,
    providerKey: event.providerKey,
    action: event.action,
    details: parseJson(event.details),
    createdAt: event.createdAt,
  }))));
});

router.get("/integrations/jobs", requireRole("owner", "admin"), async (req: TenantRequest, res): Promise<void> => {
  const query = ListIntegrationJobsQueryParams.safeParse(req.query);
  const definition = query.success ? getConnectorDefinition(query.data.providerKey) : undefined;
  if (!query.success || !definition) {
    res.status(404).json({ error: "Integration provider not found" });
    return;
  }

  if (!await entitledConnector(req.tenantId!, definition.providerKey)) {
    res.status(404).json({ error: "Integration provider not available" });
    return;
  }

  const jobs = await db.select().from(integrationJobsTable)
    .where(and(
      eq(integrationJobsTable.tenantId, req.tenantId!),
      eq(integrationJobsTable.environmentId, req.environmentId!),
      eq(integrationJobsTable.providerKey, query.data.providerKey),
    ))
    .orderBy(desc(integrationJobsTable.updatedAt))
    .limit(query.data.limit);

  res.json(ListIntegrationJobsResponse.parse(jobs.map(serializeJob)));
});

router.post("/integrations/jobs/:jobId/retry", requireRole("owner", "admin"), async (req: TenantRequest, res): Promise<void> => {
  const params = RetryIntegrationJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid integration job" });
    return;
  }
  const result = await mutateJob(req, params.data.jobId, "retry");
  if (result.kind === "missing") {
    res.status(404).json({ error: "Integration job not available" });
    return;
  }
  if (result.kind === "rate_limited") {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    res.status(429).json({ error: "Retry requests are limited. Try again shortly." });
    return;
  }
  if (result.kind === "ineligible") {
    res.status(409).json({ error: "Only retrying or dead-letter connector jobs can be queued again." });
    return;
  }
  res.json(serializeJob(result.job));
});

router.post("/integrations/jobs/:jobId/review", requireRole("owner", "admin"), async (req: TenantRequest, res): Promise<void> => {
  const params = ReviewIntegrationJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid integration job" });
    return;
  }
  const result = await mutateJob(req, params.data.jobId, "review");
  if (result.kind === "missing") {
    res.status(404).json({ error: "Integration job not available" });
    return;
  }
  if (result.kind === "rate_limited") {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    res.status(429).json({ error: "Review requests are limited. Try again shortly." });
    return;
  }
  if (result.kind === "ineligible") {
    res.status(409).json({ error: "Only dead-letter connector jobs can be marked reviewed." });
    return;
  }
  res.json(serializeJob(result.job));
});

export default router;