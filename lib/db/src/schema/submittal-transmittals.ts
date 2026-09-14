import { date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { submittalPackagesTable, submittalRevisionsTable } from "./submittals";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

export const submittalTransmittalsTable = pgTable("submittal_transmittals", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull().references(() => submittalPackagesTable.id, { onDelete: "cascade" }),
  revisionId: integer("revision_id").references(() => submittalRevisionsTable.id, { onDelete: "set null" }),
  transmittalNumber: text("transmittal_number").notNull(),
  purpose: text("purpose").notNull().default("review"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  dueDate: date("due_date", { mode: "string" }),
  fromParty: text("from_party"),
  toParty: text("to_party"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("submittal_transmittals_package_idx").on(table.packageId),
  index("submittal_transmittals_tenant_environment_idx").on(table.tenantId, table.environmentId),
]);

export type SubmittalTransmittal = typeof submittalTransmittalsTable.$inferSelect;