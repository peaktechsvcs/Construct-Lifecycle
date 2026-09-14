import { index, integer, pgTable, serial, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bidsTable } from "./bids";
import { proposalsTable } from "./proposals";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

export const bidProposalAttachmentsTable = pgTable("bid_proposal_attachments", {
  id: serial("id").primaryKey(),
  bidId: integer("bid_id").references(() => bidsTable.id, { onDelete: "cascade" }),
  proposalId: integer("proposal_id").references(() => proposalsTable.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull().default("other"),
  title: text("title").notNull(),
  description: text("description"),
  documentName: text("document_name"),
  documentUrl: text("document_url"),
  integrationProviderKey: text("integration_provider_key"),
  externalReference: text("external_reference"),
  metadata: text("metadata"),
  conversionStatus: text("conversion_status").notNull().default("open"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("bid_proposal_attachment_single_parent_check", sql`((bid_id IS NOT NULL)::int + (proposal_id IS NOT NULL)::int = 1)`),
  index("bid_proposal_attachments_bid_idx").on(table.tenantId, table.environmentId, table.bidId),
  index("bid_proposal_attachments_proposal_idx").on(table.tenantId, table.environmentId, table.proposalId),
  index("bid_proposal_attachments_purpose_idx").on(table.tenantId, table.environmentId, table.purpose),
]);

export type BidProposalAttachment = typeof bidProposalAttachmentsTable.$inferSelect;