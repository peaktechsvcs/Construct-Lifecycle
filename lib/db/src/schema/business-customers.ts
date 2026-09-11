import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { environmentsTable, tenantsTable } from "./tenants";

export const businessCustomersTable = pgTable("business_customers", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  customerType: text("customer_type").notNull().default("business"),
  primaryContact: text("primary_contact"),
  email: text("email"),
  phone: text("phone"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("business_customers_tenant_environment_name_idx").on(
    table.tenantId,
    table.environmentId,
    table.normalizedName,
  ),
  index("business_customers_tenant_environment_idx").on(table.tenantId, table.environmentId),
]);

export const insertBusinessCustomerSchema = createInsertSchema(businessCustomersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BusinessCustomer = typeof businessCustomersTable.$inferSelect;
export type BusinessCustomerInput = z.infer<typeof insertBusinessCustomerSchema>;