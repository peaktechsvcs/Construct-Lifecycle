import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { tenantsTable, usersTable } from "./tenants";

export const tenantBillingAccountsTable = pgTable("tenant_billing_accounts", {
  tenantId: integer("tenant_id").primaryKey().references(() => tenantsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("stripe"),
  externalCustomerId: text("external_customer_id").notNull().unique(),
  billingContactEmail: text("billing_contact_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const tenantEntitlementOverridesTable = pgTable("tenant_entitlement_overrides", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  capabilityKey: text("capability_key").notNull(),
  enabled: boolean("enabled").notNull(),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("tenant_entitlement_overrides_tenant_capability_idx").on(table.tenantId, table.capabilityKey),
  index("tenant_entitlement_overrides_tenant_idx").on(table.tenantId),
]);

export const subscriptionAuditEventsTable = pgTable("subscription_audit_events", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  previousState: text("previous_state"),
  newState: text("new_state"),
  providerReference: text("provider_reference"),
  details: text("details").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("subscription_audit_events_tenant_idx").on(table.tenantId),
  index("subscription_audit_events_created_idx").on(table.createdAt),
]);

export const stripeWebhookEventsTable = pgTable("stripe_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("stripe_webhook_events_processed_idx").on(table.processedAt),
]);

export const insertTenantBillingAccountSchema = createInsertSchema(tenantBillingAccountsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export const insertTenantEntitlementOverrideSchema = createInsertSchema(tenantEntitlementOverridesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSubscriptionAuditEventSchema = createInsertSchema(subscriptionAuditEventsTable).omit({
  id: true,
  createdAt: true,
});

export type TenantBillingAccount = typeof tenantBillingAccountsTable.$inferSelect;
export type TenantEntitlementOverride = typeof tenantEntitlementOverridesTable.$inferSelect;
export type SubscriptionAuditEvent = typeof subscriptionAuditEventsTable.$inferSelect;
export type StripeWebhookEvent = typeof stripeWebhookEventsTable.$inferSelect;
export type TenantBillingAccountInput = z.infer<typeof insertTenantBillingAccountSchema>;
export type TenantEntitlementOverrideInput = z.infer<typeof insertTenantEntitlementOverrideSchema>;
export type SubscriptionAuditEventInput = z.infer<typeof insertSubscriptionAuditEventSchema>;