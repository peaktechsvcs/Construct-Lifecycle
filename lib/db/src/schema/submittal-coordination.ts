import { date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { submittalPackagesTable, submittalRevisionsTable } from "./submittals";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

export const submittalCoordinationTable = pgTable("submittal_coordination", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull().references(() => submittalPackagesTable.id, { onDelete: "cascade" }),
  revisionId: integer("revision_id").references(() => submittalRevisionsTable.id, { onDelete: "set null" }),
  coordinationType: text("coordination_type").notNull(),
  status: text("status").notNull().default("pending"),
  ownerName: text("owner_name"),
  externalReference: text("external_reference"),
  notes: text("notes"),
  dueDate: date("due_date", { mode: "string" }),
  failureReason: text("failure_reason"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("submittal_coordination_package_idx").on(table.packageId),
  index("submittal_coordination_tenant_environment_idx").on(table.tenantId, table.environmentId),
  index("submittal_coordination_status_idx").on(table.tenantId, table.environmentId, table.status),
]);

export type SubmittalCoordination = typeof submittalCoordinationTable.$inferSelect;