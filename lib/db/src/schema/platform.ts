import { integer, pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
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