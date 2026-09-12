import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const TENANT_BUSINESS_TYPES = [
  "general-contractor",
  "subcontractor",
  "supplier",
] as const;

export type TenantBusinessType = (typeof TENANT_BUSINESS_TYPES)[number];

export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantBusinessTypesTable = pgTable("tenant_business_types", {
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  businessType: text("business_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tenant_business_types_tenant_type_idx").on(table.tenantId, table.businessType),
  index("tenant_business_types_tenant_idx").on(table.tenantId),
]);

export const environmentsTable = pgTable("customer_environments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  kind: text("kind").notNull().default("dtd"),
  status: text("status").notNull().default("active"),
  provisioningStatus: text("provisioning_status"),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("customer_environments_tenant_slug_idx").on(table.tenantId, table.slug),
  index("customer_environments_tenant_idx").on(table.tenantId),
]);

export const usersTable = pgTable("local_users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const membershipsTable = pgTable("tenant_memberships", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tenant_memberships_tenant_user_idx").on(table.tenantId, table.userId),
  index("tenant_memberships_user_idx").on(table.userId),
]);

export const tenantInvitationsTable = pgTable("tenant_invitations", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  invitedByUserId: integer("invited_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("tenant_invitations_tenant_idx").on(table.tenantId),
  index("tenant_invitations_email_idx").on(table.tenantId, table.email),
]);

export const userTenantContextTable = pgTable("user_tenant_context", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  activeTenantId: integer("active_tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  activeEnvironmentId: integer("active_environment_id").references(() => environmentsTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantBrandingDraftsTable = pgTable("tenant_branding_drafts", {
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  data: text("data").notNull().default("{}"),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("tenant_branding_drafts_tenant_environment_idx").on(table.tenantId, table.environmentId)]);

export const tenantBrandingVersionsTable = pgTable("tenant_branding_versions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  data: text("data").notNull(),
  publishedByUserId: integer("published_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tenant_branding_versions_tenant_environment_version_idx").on(table.tenantId, table.environmentId, table.version),
  index("tenant_branding_versions_tenant_environment_idx").on(table.tenantId, table.environmentId),
]);

export const platformReleasesTable = pgTable("platform_releases", {
  id: serial("id").primaryKey(),
  releaseType: text("release_type").notNull(),
  status: text("status").notNull().default("draft"),
  version: text("version").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("platform_releases_type_version_idx").on(table.releaseType, table.version)]);

export const environmentReleaseAssignmentsTable = pgTable("environment_release_assignments", {
  id: serial("id").primaryKey(),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
  releaseId: integer("release_id").notNull().references(() => platformReleasesTable.id, { onDelete: "cascade" }),
  approvalStatus: text("approval_status").notNull().default("pending"),
  approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("environment_release_assignment_idx").on(table.environmentId, table.releaseId)]);

export type Tenant = typeof tenantsTable.$inferSelect;
export type LocalUser = typeof usersTable.$inferSelect;
export type TenantMembership = typeof membershipsTable.$inferSelect;
export type Environment = typeof environmentsTable.$inferSelect;
export type TenantInvitation = typeof tenantInvitationsTable.$inferSelect;
export type PlatformRelease = typeof platformReleasesTable.$inferSelect;