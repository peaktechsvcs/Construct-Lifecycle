import {
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { bidsTable } from "./bids";
import { projectsTable } from "./projects";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

export const submittalPackagesTable = pgTable("submittal_packages", {
  id: serial("id").primaryKey(),
  packageNumber: text("package_number").notNull(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  sourceBidId: integer("source_bid_id").references(() => bidsTable.id, { onDelete: "set null" }),
  originType: text("origin_type").notNull().default("contract"),
  name: text("name").notNull(),
  description: text("description"),
  specificationSection: text("specification_section"),
  responsibleParty: text("responsible_party"),
  status: text("status").notNull().default("draft"),
  dueDate: date("due_date", { mode: "string" }),
  revision: integer("revision").notNull().default(0),
  reviewerName: text("reviewer_name"),
  reviewComments: text("review_comments"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("submittal_packages_tenant_environment_idx").on(table.tenantId, table.environmentId),
  index("submittal_packages_project_idx").on(table.tenantId, table.environmentId, table.projectId),
  index("submittal_packages_status_idx").on(table.tenantId, table.environmentId, table.status),
]);

export const submittalItemsTable = pgTable("submittal_items", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull().references(() => submittalPackagesTable.id, { onDelete: "cascade" }),
  itemNumber: text("item_number").notNull(),
  itemType: text("item_type").notNull().default("product_data"),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  documentName: text("document_name"),
  documentUrl: text("document_url"),
  revision: integer("revision").notNull().default(0),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("submittal_items_package_idx").on(table.packageId),
  index("submittal_items_tenant_environment_idx").on(table.tenantId, table.environmentId),
]);

export const submittalRevisionsTable = pgTable("submittal_revisions", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull().references(() => submittalPackagesTable.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  status: text("status").notNull(),
  reviewerName: text("reviewer_name"),
  reviewComments: text("review_comments"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("submittal_revisions_package_idx").on(table.packageId),
  index("submittal_revisions_tenant_environment_idx").on(table.tenantId, table.environmentId),
]);

export type SubmittalPackage = typeof submittalPackagesTable.$inferSelect;
export type SubmittalItem = typeof submittalItemsTable.$inferSelect;
export type SubmittalRevision = typeof submittalRevisionsTable.$inferSelect;