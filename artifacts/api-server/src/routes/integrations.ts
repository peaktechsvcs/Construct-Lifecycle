import { Router, type IRouter } from "express";
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
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import { connectorCatalog, getConnectorDefinition } from "../lib/integrations/catalog";

const router: IRouter = Router();

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

router.get("/integrations/activity", requireRole("owner", "admin"), async (req: TenantRequest, res): Promise<void> => {
  const query = ListIntegrationActivityQueryParams.safeParse(req.query);
  if (!query.success || !getConnectorDefinition(query.data.providerKey)) {
    res.status(404).json({ error: "Integration provider not found" });
    return;
  }

  const [entitlement] = await db.select().from(integrationEntitlementsTable).where(and(
    eq(integrationEntitlementsTable.tenantId, req.tenantId!),
    eq(integrationEntitlementsTable.capabilityKey, query.data.providerKey),
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