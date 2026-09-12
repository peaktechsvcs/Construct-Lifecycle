import { index, integer, numeric, pgTable, serial, text, timestamp, date } from "drizzle-orm/pg-core";
import { bidsTable } from "./bids";
import { businessCustomersTable } from "./business-customers";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

export const estimatesTable = pgTable("estimates", {
  id: serial("id").primaryKey(),
  estimateNumber: text("estimate_number").notNull(),
  businessCustomerId: integer("business_customer_id").notNull().references(() => businessCustomersTable.id, { onDelete: "restrict" }),
  bidId: integer("bid_id").references(() => bidsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  stage: text("stage").notNull().default("draft"),
  laborValue: numeric("labor_value", { precision: 12, scale: 2 }).notNull().default("0"),
  materialValue: numeric("material_value", { precision: 12, scale: 2 }).notNull().default("0"),
  subcontractValue: numeric("subcontract_value", { precision: 12, scale: 2 }).notNull().default("0"),
  otherValue: numeric("other_value", { precision: 12, scale: 2 }).notNull().default("0"),
  contingencyValue: numeric("contingency_value", { precision: 12, scale: 2 }).notNull().default("0"),
  totalValue: numeric("total_value", { precision: 12, scale: 2 }).notNull().default("0"),
  dueDate: date("due_date", { mode: "string" }),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  integrationProviderKey: text("integration_provider_key"),
  integrationKind: text("integration_kind"),
  integrationStatus: text("integration_status").notNull().default("manual"),
  externalReference: text("external_reference"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("estimates_tenant_environment_idx").on(table.tenantId, table.environmentId),
  index("estimates_owner_idx").on(table.tenantId, table.environmentId, table.ownerUserId),
  index("estimates_bid_idx").on(table.tenantId, table.environmentId, table.bidId),
  index("estimates_integration_idx").on(table.tenantId, table.environmentId, table.integrationProviderKey),
]);

export type Estimate = typeof estimatesTable.$inferSelect;