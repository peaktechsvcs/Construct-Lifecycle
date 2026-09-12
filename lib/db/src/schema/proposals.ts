import { date, index, integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { bidsTable } from "./bids";
import { businessCustomersTable } from "./business-customers";
import { estimatesTable } from "./estimates";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

export const proposalsTable = pgTable("proposals", {
  id: serial("id").primaryKey(),
  proposalNumber: text("proposal_number").notNull(),
  businessCustomerId: integer("business_customer_id").notNull().references(() => businessCustomersTable.id, { onDelete: "restrict" }),
  estimateId: integer("estimate_id").references(() => estimatesTable.id, { onDelete: "set null" }),
  bidId: integer("bid_id").references(() => bidsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  stage: text("stage").notNull().default("draft"),
  proposalValue: numeric("proposal_value", { precision: 12, scale: 2 }).notNull().default("0"),
  validUntil: date("valid_until", { mode: "string" }),
  recipientName: text("recipient_name"),
  recipientEmail: text("recipient_email"),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  integrationProviderKey: text("integration_provider_key"),
  integrationKind: text("integration_kind"),
  integrationStatus: text("integration_status").notNull().default("manual"),
  externalReference: text("external_reference"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("proposals_tenant_environment_idx").on(table.tenantId, table.environmentId),
  index("proposals_owner_idx").on(table.tenantId, table.environmentId, table.ownerUserId),
  index("proposals_estimate_idx").on(table.tenantId, table.environmentId, table.estimateId),
  index("proposals_bid_idx").on(table.tenantId, table.environmentId, table.bidId),
  index("proposals_integration_idx").on(table.tenantId, table.environmentId, table.integrationProviderKey),
]);

export type Proposal = typeof proposalsTable.$inferSelect;