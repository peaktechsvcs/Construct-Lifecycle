import { Router, type IRouter } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  integrationAuditEventsTable,
  integrationEntitlementsTable,
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
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import { connectorCatalog, getConnectorDefinition } from "../lib/integrations/catalog";

const router: IRouter = Router();
const connectors = new ReplitConnectors();

const unusableConnectorStatuses = new Set(["disconnected", "failed", "invalid", "revoked", "expired"]);

export function selectManagedConnection(
  connections: Array<{ id: string; status?: string | null }>,
) {
  const usable = connections.filter((connection) =>
    !unusableConnectorStatuses.has(connection.status?.toLowerCase() ?? ""),
  );
  if (usable.length === 0) return { kind: "missing" as const };
  if (usable.length > 1) return { kind: "ambiguous" as const };
  return { kind: "selected" as const, connection: usable[0] };
}

export const managedCredentialsReference = (connectorName: string, connectionId: string) =>
  `replit-connector:${connectorName}:${connectionId}`;

const serializeConnection = (connection: typeof integrationsTable.$inferSelect) => ({
  id: connection.id,
  status: connection.status,
  connectionType: connection.connectionType,
  lastSyncAt: connection.lastSyncAt,
  lastSyncStatus: connection.lastSyncStatus,
  lastError: connection.lastError,
});

const entitledConnector = async (tenantId: number, providerKey: string) => {
  const definition = getConnectorDefinition(providerKey);
  if (!definition) return null;
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

router.get("/integrations", requireRole("owner", "admin"), async (req: TenantRequest, res): Promise<void> => {
  const [entitlements, connections, latestActivity] = await Promise.all([
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
  ]);

  const entitlementKeys = new Set(entitlements.map((entitlement) => entitlement.capabilityKey));
  const connectionByProvider = new Map(connections.map((connection) => [connection.providerKey, connection]));
  const activityByProvider = new Map(latestActivity.map((activity) => [activity.providerKey, activity]));

  const response = connectorCatalog
    .filter((connector) => entitlementKeys.has(connector.entitlementKey))
    .map((connector) => {
      const connection = connectionByProvider.get(connector.providerKey);
      const activity = activityByProvider.get(connector.providerKey);
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
        connection: connection ? {
          id: connection.id,
          status: connection.status,
          connectionType: connection.connectionType,
          lastSyncAt: connection.lastSyncAt,
          lastSyncStatus: connection.lastSyncStatus,
          lastError: connection.lastError,
        } : null,
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
    const connected = await db.transaction(async (tx) => {
      const [row] = await tx.insert(integrationsTable).values({
        tenantId: req.tenantId!,
        environmentId: req.environmentId!,
        providerKey: definition.providerKey,
        providerCategory: definition.category,
        status: "connected",
        connectionType: "replit_managed_oauth",
        configuration: JSON.stringify({ connectorName: definition.managedConnectorName }),
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
          configuration: JSON.stringify({ connectorName: definition.managedConnectorName }),
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

  const [entitlement] = await db.select().from(integrationEntitlementsTable).where(and(
    eq(integrationEntitlementsTable.tenantId, req.tenantId!),
    eq(integrationEntitlementsTable.capabilityKey, definition.entitlementKey),
    eq(integrationEntitlementsTable.enabled, true),
  ));
  if (!entitlement) {
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

export default router;