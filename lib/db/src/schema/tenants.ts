import { integer, pgTable, serial, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usersTable = pgTable("local_users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
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

export const userTenantContextTable = pgTable("user_tenant_context", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  activeTenantId: integer("active_tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantBrandingDraftsTable = pgTable("tenant_branding_drafts", {
  tenantId: integer("tenant_id").primaryKey().references(() => tenantsTable.id, { onDelete: "cascade" }),
  data: text("data").notNull().default("{}"),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantBrandingVersionsTable = pgTable("tenant_branding_versions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  data: text("data").notNull(),
  publishedByUserId: integer("published_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tenant_branding_versions_tenant_version_idx").on(table.tenantId, table.version),
  index("tenant_branding_versions_tenant_idx").on(table.tenantId),
]);

export type Tenant = typeof tenantsTable.$inferSelect;
export type LocalUser = typeof usersTable.$inferSelect;
export type TenantMembership = typeof membershipsTable.$inferSelect;