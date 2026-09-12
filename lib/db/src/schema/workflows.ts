import { boolean, integer, pgTable, serial, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable, environmentsTable, usersTable } from "./tenants";

export const workflowTemplatesTable = pgTable("workflow_templates", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  activeProjectStatusKeys: text("active_project_status_keys").array().notNull().default(["active", "waiting"]),
  status: text("status").notNull().default("published"),
  isDefault: boolean("is_default").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  publishedByUserId: integer("published_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("workflow_templates_tenant_environment_idx").on(table.tenantId, table.environmentId),
  uniqueIndex("workflow_templates_tenant_environment_name_version_idx").on(table.tenantId, table.environmentId, table.name, table.version),
]);

export const workflowStatesTable = pgTable("workflow_states", {
  id: serial("id").primaryKey(),
  workflowTemplateId: integer("workflow_template_id").notNull().references(() => workflowTemplatesTable.id, { onDelete: "cascade" }),
  stableKey: text("stable_key").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  normalizedCategory: text("normalized_category").notNull().default("EXECUTION"),
  displayOrder: integer("display_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  terminal: boolean("terminal").notNull().default(false),
  allowManualEnter: boolean("allow_manual_enter").notNull().default(true),
  allowManualLeave: boolean("allow_manual_leave").notNull().default(true),
  defaultStatusKey: text("default_status_key"),
  requiredFields: text("required_fields").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("workflow_states_template_key_idx").on(table.workflowTemplateId, table.stableKey),
  index("workflow_states_template_order_idx").on(table.workflowTemplateId, table.displayOrder),
]);

export const workflowStatusesTable = pgTable("workflow_statuses", {
  id: serial("id").primaryKey(),
  workflowTemplateId: integer("workflow_template_id").notNull().references(() => workflowTemplatesTable.id, { onDelete: "cascade" }),
  stableKey: text("stable_key").notNull(),
  displayName: text("display_name").notNull(),
  stateKeys: text("state_keys").array().notNull().default([]),
  displayOrder: integer("display_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  required: boolean("required").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("workflow_statuses_template_key_idx").on(table.workflowTemplateId, table.stableKey),
  index("workflow_statuses_template_order_idx").on(table.workflowTemplateId, table.displayOrder),
]);

export const workflowTransitionsTable = pgTable("workflow_transitions", {
  id: serial("id").primaryKey(),
  workflowTemplateId: integer("workflow_template_id").notNull().references(() => workflowTemplatesTable.id, { onDelete: "cascade" }),
  fromStateKey: text("from_state_key").notNull(),
  toStateKey: text("to_state_key").notNull(),
  active: boolean("active").notNull().default(true),
  requiresConfirmation: boolean("requires_confirmation").notNull().default(false),
  allowedRoles: text("allowed_roles").array().notNull().default([]),
  requiredFields: text("required_fields").array().notNull().default([]),
  warningFields: text("warning_fields").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("workflow_transitions_template_states_idx").on(table.workflowTemplateId, table.fromStateKey, table.toStateKey),
  index("workflow_transitions_template_from_idx").on(table.workflowTemplateId, table.fromStateKey),
]);

export type WorkflowTemplate = typeof workflowTemplatesTable.$inferSelect;
export type WorkflowState = typeof workflowStatesTable.$inferSelect;
export type WorkflowStatus = typeof workflowStatusesTable.$inferSelect;
export type WorkflowTransition = typeof workflowTransitionsTable.$inferSelect;