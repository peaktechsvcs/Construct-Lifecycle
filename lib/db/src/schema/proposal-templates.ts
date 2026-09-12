import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

export const proposalTemplatesTable = pgTable("proposal_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  scope: text("scope").notNull().default("default"),
  specialty: text("specialty"),
  content: text("content").notNull(),
  isPlatformDefault: boolean("is_platform_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("proposal_templates_tenant_environment_idx").on(table.tenantId, table.environmentId),
  index("proposal_templates_scope_idx").on(table.scope, table.specialty),
]);

export type ProposalTemplate = typeof proposalTemplatesTable.$inferSelect;