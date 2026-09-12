import { date, index, integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { businessCustomersTable } from "./business-customers";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

export const opportunitiesTable = pgTable("opportunities", {
  id: serial("id").primaryKey(),
  opportunityNumber: text("opportunity_number").notNull(),
  businessCustomerId: integer("business_customer_id").notNull().references(() => businessCustomersTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description"),
  stage: text("stage").notNull().default("new"),
  estimatedValue: numeric("estimated_value", { precision: 12, scale: 2 }).notNull().default("0"),
  expectedCloseDate: date("expected_close_date", { mode: "string" }),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  leadSource: text("lead_source"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  qualification: text("qualification").notNull().default("unqualified"),
  nextAction: text("next_action"),
  nextActionDate: date("next_action_date", { mode: "string" }),
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
  crmProviderKey: text("crm_provider_key"),
  crmIntegrationStatus: text("crm_integration_status").notNull().default("manual"),
  crmExternalReference: text("crm_external_reference"),
  crmLastSyncedAt: timestamp("crm_last_synced_at", { withTimezone: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("opportunities_tenant_environment_idx").on(table.tenantId, table.environmentId),
  index("opportunities_owner_idx").on(table.tenantId, table.environmentId, table.ownerUserId),
]);

export type Opportunity = typeof opportunitiesTable.$inferSelect;