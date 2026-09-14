import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { submittalItemsTable } from "./submittals";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

export const submittalDocumentsTable = pgTable("submittal_documents", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => submittalItemsTable.id, { onDelete: "cascade" }),
  originalName: text("original_name").notNull(),
  objectPath: text("object_path").notNull().unique(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  pageCount: integer("page_count"),
  pageOrder: text("page_order"),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("pending"),
  providerKey: text("provider_key"),
  externalId: text("external_id"),
  sourceUrl: text("source_url"),
  importStatus: text("import_status").notNull().default("not_imported"),
  failureReason: text("failure_reason"),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("submittal_documents_item_idx").on(table.itemId),
  index("submittal_documents_tenant_environment_idx").on(table.tenantId, table.environmentId),
  uniqueIndex("submittal_documents_item_provider_external_idx").on(table.itemId, table.providerKey, table.externalId),
]);

export type SubmittalDocument = typeof submittalDocumentsTable.$inferSelect;