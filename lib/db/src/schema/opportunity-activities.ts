import { createInsertSchema } from "drizzle-zod";
import {
  date,
  index,
  integer,
  boolean,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { opportunitiesTable } from "./opportunities";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

export const opportunityActivitiesTable = pgTable("opportunity_activities", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id")
    .notNull()
    .references(() => opportunitiesTable.id, { onDelete: "cascade" }),
  tenantId: integer("tenant_id")
    .notNull()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id")
    .notNull()
    .references(() => environmentsTable.id, { onDelete: "cascade" }),
  activityType: text("activity_type").notNull().default("note"),
  subject: text("subject").notNull(),
  body: text("body"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  nextActionDate: date("next_action_date", { mode: "string" }),
  completed: boolean("completed").notNull().default(false),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("opportunity_activities_tenant_environment_opportunity_idx")
    .on(table.tenantId, table.environmentId, table.opportunityId),
  index("opportunity_activities_tenant_environment_next_action_idx")
    .on(table.tenantId, table.environmentId, table.nextActionDate),
]);

export const insertOpportunityActivitySchema = createInsertSchema(opportunityActivitiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type OpportunityActivity = typeof opportunityActivitiesTable.$inferSelect;
export type OpportunityActivityInput = typeof opportunityActivitiesTable.$inferInsert;