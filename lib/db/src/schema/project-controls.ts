import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { bidsTable } from "./bids";
import { projectsTable } from "./projects";
import { submittalPackagesTable } from "./submittals";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

const scopeColumns = {
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
};

export const projectContractsTable = pgTable("project_contracts", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  contractNumber: text("contract_number").notNull(),
  deliveryMethod: text("delivery_method").notNull().default("design_bid_build"),
  originalValue: numeric("original_value", { precision: 14, scale: 2 }).notNull().default("0"),
  currentValue: numeric("current_value", { precision: 14, scale: 2 }).notNull().default("0"),
  contractStart: date("contract_start", { mode: "string" }),
  contractEnd: date("contract_end", { mode: "string" }),
  noticeToProceed: date("notice_to_proceed", { mode: "string" }),
  paymentTerms: text("payment_terms"),
  retainagePercent: numeric("retainage_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  retainageCap: numeric("retainage_cap", { precision: 14, scale: 2 }),
  approvalStatus: text("approval_status").notNull().default("draft"),
  status: text("status").notNull().default("active"),
  documentUrl: text("document_url"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("project_contracts_scope_project_idx").on(table.tenantId, table.environmentId, table.projectId),
  index("project_contracts_scope_idx").on(table.tenantId, table.environmentId),
]);

export const contractParticipantsTable = pgTable("contract_participants", {
  id: serial("id").primaryKey(),
  contractId: integer("contract_id").notNull().references(() => projectContractsTable.id, { onDelete: "cascade" }),
  participantType: text("participant_type").notNull(),
  organizationName: text("organization_name").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  role: text("role"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("contract_participants_contract_idx").on(table.contractId),
  index("contract_participants_scope_idx").on(table.tenantId, table.environmentId),
]);

export const projectScheduleItemsTable = pgTable("project_schedule_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  contractId: integer("contract_id").references(() => projectContractsTable.id, { onDelete: "set null" }),
  parentItemId: integer("parent_item_id"),
  itemNumber: text("item_number").notNull(),
  name: text("name").notNull(),
  itemType: text("item_type").notNull().default("milestone"),
  predecessor: text("predecessor"),
  plannedStart: date("planned_start", { mode: "string" }),
  plannedEnd: date("planned_end", { mode: "string" }),
  actualStart: date("actual_start", { mode: "string" }),
  actualEnd: date("actual_end", { mode: "string" }),
  status: text("status").notNull().default("planned"),
  ownerName: text("owner_name"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("project_schedule_items_project_idx").on(table.tenantId, table.environmentId, table.projectId),
  index("project_schedule_items_scope_idx").on(table.tenantId, table.environmentId),
]);

export const scheduleOfValuesTable = pgTable("schedule_of_values", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  contractId: integer("contract_id").references(() => projectContractsTable.id, { onDelete: "set null" }),
  lineNumber: text("line_number").notNull(),
  costCode: text("cost_code"),
  description: text("description").notNull(),
  scheduledValue: numeric("scheduled_value", { precision: 14, scale: 2 }).notNull().default("0"),
  approvedValue: numeric("approved_value", { precision: 14, scale: 2 }).notNull().default("0"),
  billedToDate: numeric("billed_to_date", { precision: 14, scale: 2 }).notNull().default("0"),
  percentComplete: numeric("percent_complete", { precision: 5, scale: 2 }).notNull().default("0"),
  retentionHeld: numeric("retention_held", { precision: 14, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("draft"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("schedule_of_values_project_line_idx").on(table.tenantId, table.environmentId, table.projectId, table.lineNumber),
  index("schedule_of_values_scope_idx").on(table.tenantId, table.environmentId),
]);

export const projectCommitmentsTable = pgTable("project_commitments", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  contractId: integer("contract_id").references(() => projectContractsTable.id, { onDelete: "set null" }),
  linkedBidId: integer("linked_bid_id").references(() => bidsTable.id, { onDelete: "set null" }),
  linkedSubmittalPackageId: integer("linked_submittal_package_id").references(() => submittalPackagesTable.id, { onDelete: "set null" }),
  commitmentNumber: text("commitment_number").notNull(),
  commitmentType: text("commitment_type").notNull().default("subcontract"),
  vendorName: text("vendor_name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  committedValue: numeric("committed_value", { precision: 14, scale: 2 }).notNull().default("0"),
  invoicedValue: numeric("invoiced_value", { precision: 14, scale: 2 }).notNull().default("0"),
  paidValue: numeric("paid_value", { precision: 14, scale: 2 }).notNull().default("0"),
  dueDate: date("due_date", { mode: "string" }),
  documentUrl: text("document_url"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("project_commitments_project_number_idx").on(table.tenantId, table.environmentId, table.projectId, table.commitmentNumber),
  index("project_commitments_scope_idx").on(table.tenantId, table.environmentId, table.projectId),
]);

export const projectIssuesTable = pgTable("project_issues", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  linkedSubmittalPackageId: integer("linked_submittal_package_id").references(() => submittalPackagesTable.id, { onDelete: "set null" }),
  issueNumber: text("issue_number").notNull(),
  issueType: text("issue_type").notNull().default("rfi"),
  subject: text("subject").notNull(),
  question: text("question").notNull(),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  responsibleParty: text("responsible_party"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("normal"),
  dueDate: date("due_date", { mode: "string" }),
  response: text("response"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  documentUrl: text("document_url"),
  costImpact: numeric("cost_impact", { precision: 14, scale: 2 }).notNull().default("0"),
  scheduleImpactDays: integer("schedule_impact_days").notNull().default(0),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("project_issues_project_number_idx").on(table.tenantId, table.environmentId, table.projectId, table.issueNumber),
  index("project_issues_scope_status_idx").on(table.tenantId, table.environmentId, table.projectId, table.status),
]);

export const projectChangeOrdersTable = pgTable("project_change_orders", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  changeNumber: text("change_number").notNull(),
  changeType: text("change_type").notNull().default("change_request"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"),
  approvalStatus: text("approval_status").notNull().default("pending"),
  proposedValue: numeric("proposed_value", { precision: 14, scale: 2 }).notNull().default("0"),
  approvedValue: numeric("approved_value", { precision: 14, scale: 2 }).notNull().default("0"),
  scheduleImpactDays: integer("schedule_impact_days").notNull().default(0),
  requestedBy: text("requested_by"),
  dueDate: date("due_date", { mode: "string" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  documentUrl: text("document_url"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("project_change_orders_project_number_idx").on(table.tenantId, table.environmentId, table.projectId, table.changeNumber),
  index("project_change_orders_scope_status_idx").on(table.tenantId, table.environmentId, table.projectId, table.status),
]);

export const projectFinancialsTable = pgTable("project_financials", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  budgetCost: numeric("budget_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  forecastCost: numeric("forecast_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  actualCost: numeric("actual_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  forecastRevenue: numeric("forecast_revenue", { precision: 14, scale: 2 }).notNull().default("0"),
  retainageHeld: numeric("retainage_held", { precision: 14, scale: 2 }).notNull().default("0"),
  asOfDate: date("as_of_date", { mode: "string" }),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("project_financials_scope_project_idx").on(table.tenantId, table.environmentId, table.projectId),
]);

export const projectPayApplicationsTable = pgTable("project_pay_applications", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  applicationNumber: text("application_number").notNull(),
  periodStart: date("period_start", { mode: "string" }),
  periodEnd: date("period_end", { mode: "string" }),
  grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  retainageAmount: numeric("retainage_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  netAmount: numeric("net_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("draft"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  notes: text("notes"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("project_pay_applications_project_number_idx").on(table.tenantId, table.environmentId, table.projectId, table.applicationNumber),
  index("project_pay_applications_scope_idx").on(table.tenantId, table.environmentId, table.projectId),
]);

export const projectCloseoutRequirementsTable = pgTable("project_closeout_requirements", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  requirementNumber: text("requirement_number").notNull(),
  requirementType: text("requirement_type").notNull().default("document"),
  title: text("title").notNull(),
  status: text("status").notNull().default("open"),
  dueDate: date("due_date", { mode: "string" }),
  responsibleParty: text("responsible_party"),
  documentUrl: text("document_url"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("project_closeout_requirements_project_number_idx").on(table.tenantId, table.environmentId, table.projectId, table.requirementNumber),
  index("project_closeout_requirements_scope_status_idx").on(table.tenantId, table.environmentId, table.projectId, table.status),
]);

export const projectControlEventsTable = pgTable("project_control_events", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  comments: text("comments"),
  details: text("details"),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("project_control_events_project_idx").on(table.tenantId, table.environmentId, table.projectId, table.createdAt),
]);

export type ProjectContract = typeof projectContractsTable.$inferSelect;
export type ContractParticipant = typeof contractParticipantsTable.$inferSelect;
export type ProjectScheduleItem = typeof projectScheduleItemsTable.$inferSelect;
export type ScheduleOfValue = typeof scheduleOfValuesTable.$inferSelect;
export type ProjectCommitment = typeof projectCommitmentsTable.$inferSelect;
export type ProjectIssue = typeof projectIssuesTable.$inferSelect;
export type ProjectChangeOrder = typeof projectChangeOrdersTable.$inferSelect;
export type ProjectFinancials = typeof projectFinancialsTable.$inferSelect;
export type ProjectPayApplication = typeof projectPayApplicationsTable.$inferSelect;
export type ProjectCloseoutRequirement = typeof projectCloseoutRequirementsTable.$inferSelect;
export type ProjectControlEvent = typeof projectControlEventsTable.$inferSelect;