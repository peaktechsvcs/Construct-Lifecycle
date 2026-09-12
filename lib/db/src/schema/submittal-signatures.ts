import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";
import { submittalPackageAssembliesTable } from "./submittal-assemblies";
import { submittalPackagesTable } from "./submittals";

export const submittalSignatureRequestsTable = pgTable("submittal_signature_requests", {
  id: serial("id").primaryKey(),
  packageId: integer("package_id").notNull().references(() => submittalPackagesTable.id, { onDelete: "cascade" }),
  assemblyId: integer("assembly_id").notNull().references(() => submittalPackageAssembliesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  providerKey: text("provider_key"),
  providerRequestId: text("provider_request_id"),
  externalMetadata: text("external_metadata").notNull().default("{}"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("submittal_signature_requests_package_idx").on(table.packageId),
  index("submittal_signature_requests_assembly_idx").on(table.assemblyId),
  index("submittal_signature_requests_tenant_environment_idx").on(table.tenantId, table.environmentId),
]);

export const submittalSignatureSignersTable = pgTable("submittal_signature_signers", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => submittalSignatureRequestsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role"),
  signingOrder: integer("signing_order").notNull().default(1),
  status: text("status").notNull().default("pending"),
  providerSignerId: text("provider_signer_id"),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("submittal_signature_signers_request_idx").on(table.requestId),
  index("submittal_signature_signers_tenant_environment_idx").on(table.tenantId, table.environmentId),
]);

export const submittalSignatureEventsTable = pgTable("submittal_signature_events", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => submittalSignatureRequestsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  details: text("details").notNull().default("{}"),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("submittal_signature_events_request_idx").on(table.requestId),
  index("submittal_signature_events_tenant_environment_idx").on(table.tenantId, table.environmentId),
  index("submittal_signature_events_created_at_idx").on(table.createdAt),
]);

export const insertSubmittalSignatureRequestSchema = createInsertSchema(submittalSignatureRequestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertSubmittalSignatureSignerSchema = createInsertSchema(submittalSignatureSignersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertSubmittalSignatureEventSchema = createInsertSchema(submittalSignatureEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertSubmittalSignatureRequest = z.infer<typeof insertSubmittalSignatureRequestSchema>;
export type InsertSubmittalSignatureSigner = z.infer<typeof insertSubmittalSignatureSignerSchema>;
export type InsertSubmittalSignatureEvent = z.infer<typeof insertSubmittalSignatureEventSchema>;
export type SubmittalSignatureRequest = typeof submittalSignatureRequestsTable.$inferSelect;
export type SubmittalSignatureSigner = typeof submittalSignatureSignersTable.$inferSelect;
export type SubmittalSignatureEvent = typeof submittalSignatureEventsTable.$inferSelect;