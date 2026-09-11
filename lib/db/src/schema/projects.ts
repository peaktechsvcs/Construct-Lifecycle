import { createInsertSchema } from "drizzle-zod";
import {
  date,
  check,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { businessCustomersTable } from "./business-customers";
import { environmentsTable, tenantsTable } from "./tenants";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  projectNumber: text("project_number").notNull(),
  businessCustomerId: integer("business_customer_id").references(() => businessCustomersTable.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  projectName: text("project_name").notNull(),
  address: text("address"),
  category: text("category").notNull(),
  productCategories: text("product_categories").array().notNull().default([]),
  owner: text("owner"),
  stage: text("stage").notNull().default("opportunity"),
  proposalStatus: text("proposal_status").notNull().default("not_started"),
  proposalDetails: text("proposal_details"),
  bidOutcome: text("bid_outcome").notNull().default("pending"),
  contractStatus: text("contract_status").notNull().default("none"),
  contractValue: numeric("contract_value", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  contractDetails: text("contract_details"),
  contractStart: date("contract_start", { mode: "string" }),
  contractEnd: date("contract_end", { mode: "string" }),
  deliveryPercent: integer("delivery_percent").notNull().default(0),
  requirementsSummary: text("requirements_summary"),
  billingStatus: text("billing_status").notNull().default("not_started"),
  invoicedAmount: numeric("invoiced_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  receivedAmount: numeric("received_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  billingDetails: text("billing_details"),
  closeoutStatus: text("closeout_status").notNull().default("not_started"),
  closeoutDetails: text("closeout_details"),
  nextFollowUp: date("next_follow_up", { mode: "string" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  workflowTemplateId: integer("workflow_template_id"),
  projectStatus: text("project_status"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
   index("projects_tenant_environment_idx").on(table.tenantId, table.environmentId),
   uniqueIndex("projects_tenant_environment_project_number_idx").on(table.tenantId, table.environmentId, table.projectNumber),
]);

export const activityTable = pgTable("project_activity", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  description: text("description").notNull(),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [index("activity_tenant_environment_idx").on(table.tenantId, table.environmentId)]);

export const followUpsTable = pgTable("follow_ups", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("open"),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [index("follow_ups_tenant_environment_idx").on(table.tenantId, table.environmentId)]);

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertActivitySchema = createInsertSchema(activityTable).omit({
  id: true,
  createdAt: true,
});
export const insertFollowUpSchema = createInsertSchema(followUpsTable).omit({
  id: true,
  createdAt: true,
});

export type Project = typeof projectsTable.$inferSelect;
export type Activity = typeof activityTable.$inferSelect;
export type FollowUp = typeof followUpsTable.$inferSelect;
export type ProjectInput = z.infer<typeof insertProjectSchema>;
export type FollowUpInput = z.infer<typeof insertFollowUpSchema>;