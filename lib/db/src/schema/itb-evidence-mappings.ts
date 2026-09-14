import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";
import { itbDocumentsTable, itbIntakesTable } from "./itb-intakes";

export const itbDocumentEvidenceMappingsTable = pgTable("itb_document_evidence_mappings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  intakeId: integer("intake_id").notNull().references(() => itbIntakesTable.id, { onDelete: "cascade" }),
  documentId: integer("document_id").notNull().references(() => itbDocumentsTable.id, { onDelete: "cascade" }),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  findingKey: text("finding_key").notNull(),
  targetField: text("target_field").notNull(),
  appliedValue: text("applied_value").notNull(),
  evidence: text("evidence").notNull(),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("itb_evidence_mappings_scope_target_idx").on(table.tenantId, table.environmentId, table.targetType, table.targetId),
  index("itb_evidence_mappings_document_idx").on(table.tenantId, table.environmentId, table.documentId),
  uniqueIndex("itb_evidence_mappings_document_field_idx").on(
    table.tenantId,
    table.environmentId,
    table.documentId,
    table.targetType,
    table.targetId,
    table.targetField,
  ),
]);

export type ItbDocumentEvidenceMapping = typeof itbDocumentEvidenceMappingsTable.$inferSelect;