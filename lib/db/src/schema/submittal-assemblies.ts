import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { submittalPackagesTable } from "./submittals";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

export const submittalPackageAssembliesTable = pgTable("submittal_package_assemblies", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull().references(() => submittalPackagesTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("ready"),
  signatureReady: boolean("signature_ready").notNull().default(false),
  signatureReadyAt: timestamp("signature_ready_at", { withTimezone: true }),
  signatureReadyByUserId: integer("signature_ready_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  originalFileName: text("original_file_name").notNull(),
  objectPath: text("object_path").notNull().unique(),
  contentType: text("content_type").notNull().default("application/pdf"),
  size: integer("size").notNull(),
  itemOrder: text("item_order").notNull(),
  pagePlan: text("page_plan").notNull(),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("submittal_package_assemblies_package_idx").on(table.packageId),
  index("submittal_package_assemblies_tenant_environment_idx").on(table.tenantId, table.environmentId),
]);

export type SubmittalPackageAssembly = typeof submittalPackageAssembliesTable.$inferSelect;