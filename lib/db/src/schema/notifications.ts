import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable, environmentsTable, usersTable } from "./tenants";

export const notificationReadsTable = pgTable("notification_reads", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  notificationKey: text("notification_key").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("notification_reads_user_key_idx").on(table.tenantId, table.environmentId, table.userId, table.notificationKey),
  index("notification_reads_user_idx").on(table.tenantId, table.environmentId, table.userId),
]);

export type NotificationRead = typeof notificationReadsTable.$inferSelect;