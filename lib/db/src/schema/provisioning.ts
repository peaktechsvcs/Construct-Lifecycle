import { integer, index, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable, environmentsTable, usersTable, environmentReleaseAssignmentsTable } from "./tenants";

export const environmentResourceTypes = [
  "runtime",
  "database",
  "storage",
  "queue",
  "secrets",
  "jobs",
  "logs",
] as const;
export type EnvironmentResourceType = (typeof environmentResourceTypes)[number];

export const environmentResourceStatuses = [
  "requested",
  "provisioning",
  "ready",
  "degraded",
  "failed",
  "deprovisioning",
  "deprovisioned",
] as const;
export type EnvironmentResourceStatus = (typeof environmentResourceStatuses)[number];

export const provisioningOperationStatuses = ["requested", "running", "succeeded", "failed"] as const;
export type ProvisioningOperationStatus = (typeof provisioningOperationStatuses)[number];

/**
 * Provider-neutral resource inventory. Each row is a separately addressable
 * resource; no application data is shared between environment resource rows.
 */
export const environmentResourcesTable = pgTable("environment_resources", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").notNull(),
  status: text("status").notNull().default("requested"),
  providerKey: text("provider_key").notNull(),
  secretReference: text("secret_reference"),
  externalId: text("external_id"),
  endpoint: text("endpoint"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  lastError: text("last_error"),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("environment_resources_environment_type_idx").on(table.environmentId, table.resourceType),
  index("environment_resources_tenant_idx").on(table.tenantId),
  index("environment_resources_status_idx").on(table.status),
]);

export const provisioningOperationsTable = pgTable("provisioning_operations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  resourceId: integer("resource_id").references(() => environmentResourcesTable.id, { onDelete: "cascade" }),
  operationType: text("operation_type").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("requested"),
  providerOperationId: text("provider_operation_id"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  error: text("error"),
  requestedByUserId: integer("requested_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("provisioning_operations_idempotency_idx").on(table.environmentId, table.operationType, table.idempotencyKey),
  index("provisioning_operations_environment_idx").on(table.tenantId, table.environmentId),
  index("provisioning_operations_status_idx").on(table.status),
]);

export const provisioningEventsTable = pgTable("provisioning_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  resourceId: integer("resource_id").references(() => environmentResourcesTable.id, { onDelete: "set null" }),
  operationId: integer("operation_id").references(() => provisioningOperationsTable.id, { onDelete: "set null" }),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("provisioning_events_environment_idx").on(table.tenantId, table.environmentId),
  index("provisioning_events_occurred_idx").on(table.occurredAt),
]);

export const environmentSnapshotsTable = pgTable("environment_snapshots", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  sourceEnvironmentId: integer("source_environment_id").references(() => environmentsTable.id, { onDelete: "set null" }),
  idempotencyKey: text("idempotency_key").notNull(),
  kind: text("kind").notNull().default("backup"),
  status: text("status").notNull().default("requested"),
  sanitized: text("sanitized").notNull().default("not_applicable"),
  sanitizationPolicy: text("sanitization_policy"),
  backupReference: text("backup_reference"),
  checksum: text("checksum"),
  verificationDetails: jsonb("verification_details").$type<Record<string, unknown>>().notNull().default({}),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("environment_snapshots_tenant_environment_idx").on(table.tenantId, table.environmentId),
  index("environment_snapshots_status_idx").on(table.status),
  uniqueIndex("environment_snapshots_environment_idempotency_idx").on(table.environmentId, table.idempotencyKey),
]);

export const environmentRefreshesTable = pgTable("environment_refreshes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  sourceEnvironmentId: integer("source_environment_id").notNull().references(() => environmentsTable.id, { onDelete: "restrict" }),
  targetEnvironmentId: integer("target_environment_id").notNull().references(() => environmentsTable.id, { onDelete: "restrict" }),
  snapshotId: integer("snapshot_id").references(() => environmentSnapshotsTable.id, { onDelete: "set null" }),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("requested"),
  sanitizationPolicy: text("sanitization_policy").notNull(),
  requestedByUserId: integer("requested_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("environment_refreshes_tenant_idx").on(table.tenantId),
  index("environment_refreshes_target_idx").on(table.targetEnvironmentId),
  uniqueIndex("environment_refreshes_target_idempotency_idx").on(table.targetEnvironmentId, table.idempotencyKey),
]);

export const environmentHealthChecksTable = pgTable("environment_health_checks", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  checks: jsonb("checks").$type<Record<string, unknown>>().notNull().default({}),
  checkedByUserId: integer("checked_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("environment_health_checks_environment_idx").on(table.tenantId, table.environmentId, table.checkedAt),
]);

export const environmentReleaseControlsTable = pgTable("environment_release_controls", {
  id: serial("id").primaryKey(),
  assignmentId: integer("assignment_id").notNull().unique().references(() => environmentReleaseAssignmentsTable.id, { onDelete: "cascade" }),
  snapshotId: integer("snapshot_id").references(() => environmentSnapshotsTable.id, { onDelete: "set null" }),
  healthCheckId: integer("health_check_id").references(() => environmentHealthChecksTable.id, { onDelete: "set null" }),
  rollbackSnapshotId: integer("rollback_snapshot_id").references(() => environmentSnapshotsTable.id, { onDelete: "set null" }),
  rollbackStatus: text("rollback_status"),
  promotedAt: timestamp("promoted_at", { withTimezone: true }),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EnvironmentResource = typeof environmentResourcesTable.$inferSelect;
export type ProvisioningOperation = typeof provisioningOperationsTable.$inferSelect;
export type ProvisioningEvent = typeof provisioningEventsTable.$inferSelect;
export type EnvironmentSnapshot = typeof environmentSnapshotsTable.$inferSelect;
export type EnvironmentRefresh = typeof environmentRefreshesTable.$inferSelect;
export type EnvironmentHealthCheck = typeof environmentHealthChecksTable.$inferSelect;