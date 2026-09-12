import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { bidsTable } from "./bids";
import { businessCustomersTable } from "./business-customers";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";
import { opportunitiesTable } from "./opportunities";

export const itbIntakesTable = pgTable("itb_intakes", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull().default("manual"),
  sourceProvider: text("source_provider"),
  sourceMessageId: text("source_message_id"),
  sourceThreadId: text("source_thread_id"),
  sourceFingerprint: text("source_fingerprint").notNull(),
  sourceMailbox: text("source_mailbox"),
  sourceSender: text("source_sender"),
  sourceSenderEmail: text("source_sender_email"),
  sourceSubject: text("source_subject"),
  sourceReceivedAt: timestamp("source_received_at", { withTimezone: true }),
  sourceBody: text("source_body").notNull().default(""),
  status: text("status").notNull().default("review"),
  extractionStatus: text("extraction_status").notNull().default("completed"),
  extractionJson: text("extraction_json").notNull().default("{}"),
  extractionWarningsJson: text("extraction_warnings_json").notNull().default("[]"),
  errorMessage: text("error_message"),
  businessCustomerId: integer("business_customer_id").references(() => businessCustomersTable.id, { onDelete: "set null" }),
  opportunityId: integer("opportunity_id").references(() => opportunitiesTable.id, { onDelete: "set null" }),
  bidId: integer("bid_id").references(() => bidsTable.id, { onDelete: "set null" }),
  mergedIntoId: integer("merged_into_id"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("itb_intakes_scope_fingerprint_idx").on(table.tenantId, table.environmentId, table.sourceFingerprint),
  index("itb_intakes_scope_status_idx").on(table.tenantId, table.environmentId, table.status),
  index("itb_intakes_scope_received_idx").on(table.tenantId, table.environmentId, table.sourceReceivedAt),
]);

export const itbIntakeAttachmentsTable = pgTable("itb_intake_attachments", {
  id: serial("id").primaryKey(),
  intakeId: integer("intake_id").notNull().references(() => itbIntakesTable.id, { onDelete: "cascade" }),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  objectPath: text("object_path").notNull(),
  sourceAttachmentId: text("source_attachment_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("itb_intake_attachments_intake_idx").on(table.intakeId),
  uniqueIndex("itb_intake_attachments_source_idx").on(table.intakeId, table.sourceAttachmentId),
]);

export const itbMailboxCursorsTable = pgTable("itb_mailbox_cursors", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  mailbox: text("mailbox").notNull().default("me"),
  query: text("query").notNull(),
  nextPageToken: text("next_page_token"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("itb_mailbox_cursors_scope_query_idx").on(table.tenantId, table.environmentId, table.provider, table.mailbox, table.query),
]);

export type ItbIntake = typeof itbIntakesTable.$inferSelect;
export type ItbIntakeAttachment = typeof itbIntakeAttachmentsTable.$inferSelect;
export type ItbMailboxCursor = typeof itbMailboxCursorsTable.$inferSelect;