import { boolean, integer, pgTable, serial, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable, usersTable } from "./tenants";

export const platformAuditEventsTable = pgTable("platform_audit_events", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actor_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  details: text("details").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("platform_audit_events_tenant_idx").on(table.tenantId),
  index("platform_audit_events_created_idx").on(table.createdAt),
]);

export type PlatformAuditEvent = typeof platformAuditEventsTable.$inferSelect;

export const platformFeatureFlagsTable = pgTable("platform_feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const featureFeedbackVotesTable = pgTable("feature_feedback_votes", {
  id: serial("id").primaryKey(),
  featureKey: text("feature_key").notNull(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("feature_feedback_votes_tenant_user_idx").on(table.tenantId, table.userId),
  index("feature_feedback_votes_feature_idx").on(table.featureKey),
]);

export type PlatformFeatureFlag = typeof platformFeatureFlagsTable.$inferSelect;
export type FeatureFeedbackVote = typeof featureFeedbackVotesTable.$inferSelect;