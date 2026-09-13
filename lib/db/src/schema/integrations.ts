import { createInsertSchema } from "drizzle-zod";
import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

export const integrationEntitlementsTable = pgTable("integration_entitlements", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  capabilityKey: text("capability_key").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("integration_entitlements_tenant_capability_idx").on(table.tenantId, table.capabilityKey),
  index("integration_entitlements_tenant_idx").on(table.tenantId),
]);

export const integrationsTable = pgTable("integrations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  providerKey: text("provider_key").notNull(),
  providerCategory: text("provider_category").notNull(),
  status: text("status").notNull().default("not_connected"),
  connectionType: text("connection_type").notNull().default("not_configured"),
  configuration: text("configuration").notNull().default("{}"),
  credentialsReference: text("credentials_reference"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncStatus: text("last_sync_status"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("integrations_tenant_environment_provider_idx").on(table.tenantId, table.environmentId, table.providerKey),
  uniqueIndex("integrations_credentials_reference_idx").on(table.credentialsReference),
  index("integrations_tenant_environment_idx").on(table.tenantId, table.environmentId),
  index("integrations_provider_idx").on(table.providerKey),
]);

export const integrationAuditEventsTable = pgTable("integration_audit_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  integrationId: integer("integration_id").references(() => integrationsTable.id, { onDelete: "set null" }),
  providerKey: text("provider_key").notNull(),
  action: text("action").notNull(),
  details: text("details").notNull().default("{}"),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("integration_audit_events_tenant_environment_idx").on(table.tenantId, table.environmentId),
  index("integration_audit_events_integration_idx").on(table.integrationId),
  index("integration_audit_events_created_at_idx").on(table.createdAt),
]);

export const insertIntegrationEntitlementSchema = createInsertSchema(integrationEntitlementsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertIntegrationSchema = createInsertSchema(integrationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertIntegrationAuditEventSchema = createInsertSchema(integrationAuditEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertIntegrationEntitlement = z.infer<typeof insertIntegrationEntitlementSchema>;
export type InsertIntegration = z.infer<typeof insertIntegrationSchema>;
export type InsertIntegrationAuditEvent = z.infer<typeof insertIntegrationAuditEventSchema>;
export type IntegrationEntitlement = typeof integrationEntitlementsTable.$inferSelect;
export type Integration = typeof integrationsTable.$inferSelect;
export type IntegrationAuditEvent = typeof integrationAuditEventsTable.$inferSelect;