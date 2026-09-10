import { createInsertSchema } from "drizzle-zod";
import {
  date,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  projectNumber: text("project_number").notNull().unique(),
  customerName: text("customer_name").notNull(),
  projectName: text("project_name").notNull(),
  address: text("address"),
  category: text("category").notNull(),
  productCategories: text("product_categories").array().notNull().default([]),
  owner: text("owner"),
  stage: text("stage").notNull().default("lead"),
  proposalStatus: text("proposal_status").notNull().default("not_started"),
  proposalDetails: text("proposal_details"),
  bidOutcome: text("bid_outcome").notNull().default("pending"),
  contractStatus: text("contract_status").notNull().default("none"),
  contractValue: numeric("contract_value", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  contractDetails: text("contract_details"),
  contractStart: date("contract_start"),
  contractEnd: date("contract_end"),
  deliveryPercent: integer("delivery_percent").notNull().default(0),
  requirementsSummary: text("requirements_summary"),
  billingStatus: text("billing_status").notNull().default("not_started"),
  invoicedAmount: numeric("invoiced_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  receivedAmount: numeric("received_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  billingDetails: text("billing_details"),
  closeoutStatus: text("closeout_status").notNull().default("not_started"),
  closeoutDetails: text("closeout_details"),
  nextFollowUp: date("next_follow_up"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const activityTable = pgTable("project_activity", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  description: text("description").notNull(),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const followUpsTable = pgTable("follow_ups", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  dueDate: date("due_date").notNull(),
  status: text("status").notNull().default("open"),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertActivitySchema = createInsertSchema(activityTable).omit({
  id: true,
  createdAt: true,
});
export const insertFollowUpSchema = createInsertSchema(followUpsTable).omit({
  id: true,
  createdAt: true,
});

export type Project = typeof projectsTable.$inferSelect;
export type Activity = typeof activityTable.$inferSelect;
export type FollowUp = typeof followUpsTable.$inferSelect;
export type ProjectInput = z.infer<typeof insertProjectSchema>;
export type FollowUpInput = z.infer<typeof insertFollowUpSchema>;