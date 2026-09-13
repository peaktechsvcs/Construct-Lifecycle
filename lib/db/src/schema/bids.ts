import { date, index, integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { businessCustomersTable } from "./business-customers";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";
import { opportunitiesTable } from "./opportunities";

export const bidsTable = pgTable("bids", {
  id: serial("id").primaryKey(),
  bidNumber: text("bid_number").notNull(),
  businessCustomerId: integer("business_customer_id").notNull().references(() => businessCustomersTable.id, { onDelete: "restrict" }),
  opportunityId: integer("opportunity_id").references(() => opportunitiesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  stage: text("stage").notNull().default("invited"),
  bidType: text("bid_type").notNull().default("general"),
  scopeMode: text("scope_mode").notNull().default("full"),
  specialty: text("specialty"),
  estimatedValue: numeric("estimated_value", { precision: 12, scale: 2 }).notNull().default("0"),
  dueDate: date("due_date", { mode: "string" }),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  takeoffProvider: text("takeoff_provider"),
  takeoffCoverage: text("takeoff_coverage").notNull().default("none"),
  estimatingProvider: text("estimating_provider"),
  estimatingCoverage: text("estimating_coverage").notNull().default("none"),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("bids_tenant_environment_idx").on(table.tenantId, table.environmentId),
  index("bids_owner_idx").on(table.tenantId, table.environmentId, table.ownerUserId),
  index("bids_opportunity_idx").on(table.tenantId, table.environmentId, table.opportunityId),
]);

export const bidScopesTable = pgTable("bid_scopes", {
  id: serial("id").primaryKey(),
  bidId: integer("bid_id").notNull().references(() => bidsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"),
  takeoffProvider: text("takeoff_provider"),
  takeoffCoverage: text("takeoff_coverage").notNull().default("none"),
  estimatingProvider: text("estimating_provider"),
  estimatingCoverage: text("estimating_coverage").notNull().default("none"),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("bid_scopes_tenant_environment_bid_idx").on(table.tenantId, table.environmentId, table.bidId),
  index("bid_scopes_owner_idx").on(table.tenantId, table.environmentId, table.ownerUserId),
]);

export type Bid = typeof bidsTable.$inferSelect;
export type BidScope = typeof bidScopesTable.$inferSelect;