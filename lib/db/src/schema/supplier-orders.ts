import {
  date,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { bidsTable } from "./bids";
import { businessCustomersTable } from "./business-customers";
import { estimatesTable } from "./estimates";
import { projectsTable } from "./projects";
import { proposalsTable } from "./proposals";
import { projectCommitmentsTable } from "./project-controls";
import { submittalPackagesTable } from "./submittals";
import { environmentsTable, tenantsTable, usersTable } from "./tenants";

const scopeColumns = {
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  environmentId: integer("environment_id").notNull().references(() => environmentsTable.id, { onDelete: "cascade" }),
};

export const supplierVendorsTable = pgTable("supplier_vendors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  leadTimeDays: integer("lead_time_days").notNull().default(0),
  status: text("status").notNull().default("active"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("supplier_vendors_scope_name_idx").on(table.tenantId, table.environmentId, table.normalizedName),
  index("supplier_vendors_scope_status_idx").on(table.tenantId, table.environmentId, table.status),
]);

export const supplierProductsTable = pgTable("supplier_products", {
  id: serial("id").primaryKey(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull().default("material"),
  unit: text("unit").notNull().default("each"),
  defaultVendorId: integer("default_vendor_id").references(() => supplierVendorsTable.id, { onDelete: "set null" }),
  leadTimeDays: integer("lead_time_days").notNull().default(0),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  listPrice: numeric("list_price", { precision: 14, scale: 2 }).notNull().default("0"),
  availableQuantity: numeric("available_quantity", { precision: 14, scale: 3 }).notNull().default("0"),
  backorderedQuantity: numeric("backordered_quantity", { precision: 14, scale: 3 }).notNull().default("0"),
  status: text("status").notNull().default("active"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("supplier_products_scope_sku_idx").on(table.tenantId, table.environmentId, table.sku),
  index("supplier_products_scope_status_idx").on(table.tenantId, table.environmentId, table.status),
]);

export const supplierPriceListsTable = pgTable("supplier_price_lists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  businessCustomerId: integer("business_customer_id").references(() => businessCustomersTable.id, { onDelete: "cascade" }),
  effectiveFrom: date("effective_from", { mode: "string" }),
  effectiveTo: date("effective_to", { mode: "string" }),
  status: text("status").notNull().default("active"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("supplier_price_lists_scope_customer_idx").on(table.tenantId, table.environmentId, table.businessCustomerId),
]);

export const supplierPriceListItemsTable = pgTable("supplier_price_list_items", {
  id: serial("id").primaryKey(),
  priceListId: integer("price_list_id").notNull().references(() => supplierPriceListsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => supplierProductsTable.id, { onDelete: "cascade" }),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  minimumQuantity: numeric("minimum_quantity", { precision: 14, scale: 3 }).notNull().default("1"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("supplier_price_list_items_product_idx").on(table.tenantId, table.environmentId, table.priceListId, table.productId),
]);

export const supplierCustomerTermsTable = pgTable("supplier_customer_terms", {
  id: serial("id").primaryKey(),
  businessCustomerId: integer("business_customer_id").notNull().references(() => businessCustomersTable.id, { onDelete: "cascade" }),
  paymentTerms: text("payment_terms").notNull().default("Net 30"),
  creditLimit: numeric("credit_limit", { precision: 14, scale: 2 }).notNull().default("0"),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  retainageRequired: numeric("retainage_required", { precision: 5, scale: 2 }).notNull().default("0"),
  waiverRequired: boolean("waiver_required").notNull().default(false),
  status: text("status").notNull().default("active"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("supplier_customer_terms_scope_customer_idx").on(table.tenantId, table.environmentId, table.businessCustomerId),
]);

export const supplierQuotesTable = pgTable("supplier_quotes", {
  id: serial("id").primaryKey(),
  quoteNumber: text("quote_number").notNull(),
  businessCustomerId: integer("business_customer_id").notNull().references(() => businessCustomersTable.id, { onDelete: "restrict" }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  bidId: integer("bid_id").references(() => bidsTable.id, { onDelete: "set null" }),
  estimateId: integer("estimate_id").references(() => estimatesTable.id, { onDelete: "set null" }),
  proposalId: integer("proposal_id").references(() => proposalsTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"),
  quoteDate: date("quote_date", { mode: "string" }),
  validUntil: date("valid_until", { mode: "string" }),
  notes: text("notes"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  totalCost: numeric("total_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  totalSell: numeric("total_sell", { precision: 14, scale: 2 }).notNull().default("0"),
  grossMargin: numeric("gross_margin", { precision: 14, scale: 2 }).notNull().default("0"),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("supplier_quotes_scope_number_idx").on(table.tenantId, table.environmentId, table.quoteNumber),
  index("supplier_quotes_scope_customer_idx").on(table.tenantId, table.environmentId, table.businessCustomerId),
  index("supplier_quotes_scope_status_idx").on(table.tenantId, table.environmentId, table.status),
]);

export const supplierQuoteLinesTable = pgTable("supplier_quote_lines", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull().references(() => supplierQuotesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => supplierProductsTable.id, { onDelete: "set null" }),
  vendorId: integer("vendor_id").references(() => supplierVendorsTable.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull().default("1"),
  unit: text("unit").notNull().default("each"),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  approvedSubstitution: text("approved_substitution"),
  promisedDate: date("promised_date", { mode: "string" }),
  scopeReference: text("scope_reference"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("supplier_quote_lines_scope_quote_idx").on(table.tenantId, table.environmentId, table.quoteId),
]);

export const supplierOrdersTable = pgTable("supplier_orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  businessCustomerId: integer("business_customer_id").notNull().references(() => businessCustomersTable.id, { onDelete: "restrict" }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  bidId: integer("bid_id").references(() => bidsTable.id, { onDelete: "set null" }),
  estimateId: integer("estimate_id").references(() => estimatesTable.id, { onDelete: "set null" }),
  proposalId: integer("proposal_id").references(() => proposalsTable.id, { onDelete: "set null" }),
  sourceQuoteId: integer("source_quote_id").references(() => supplierQuotesTable.id, { onDelete: "set null" }),
  linkedCommitmentId: integer("linked_commitment_id").references(() => projectCommitmentsTable.id, { onDelete: "set null" }),
  linkedSubmittalPackageId: integer("linked_submittal_package_id").references(() => submittalPackagesTable.id, { onDelete: "set null" }),
  orderStatus: text("order_status").notNull().default("draft"),
  paymentStatus: text("payment_status").notNull().default("unbilled"),
  orderDate: date("order_date", { mode: "string" }),
  promisedDate: date("promised_date", { mode: "string" }),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  totalCost: numeric("total_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  totalSell: numeric("total_sell", { precision: 14, scale: 2 }).notNull().default("0"),
  grossMargin: numeric("gross_margin", { precision: 14, scale: 2 }).notNull().default("0"),
  jobsiteInstructions: text("jobsite_instructions"),
  customerVisibleStatus: text("customer_visible_status").notNull().default("draft"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("supplier_orders_scope_number_idx").on(table.tenantId, table.environmentId, table.orderNumber),
  index("supplier_orders_scope_customer_idx").on(table.tenantId, table.environmentId, table.businessCustomerId),
  index("supplier_orders_scope_project_idx").on(table.tenantId, table.environmentId, table.projectId),
  index("supplier_orders_scope_status_idx").on(table.tenantId, table.environmentId, table.orderStatus),
]);

export const supplierOrderLinesTable = pgTable("supplier_order_lines", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => supplierOrdersTable.id, { onDelete: "cascade" }),
  sourceQuoteLineId: integer("source_quote_line_id").references(() => supplierQuoteLinesTable.id, { onDelete: "set null" }),
  productId: integer("product_id").references(() => supplierProductsTable.id, { onDelete: "set null" }),
  vendorId: integer("vendor_id").references(() => supplierVendorsTable.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull().default("1"),
  unit: text("unit").notNull().default("each"),
  unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  purchasedQuantity: numeric("purchased_quantity", { precision: 14, scale: 3 }).notNull().default("0"),
  deliveredQuantity: numeric("delivered_quantity", { precision: 14, scale: 3 }).notNull().default("0"),
  receivedQuantity: numeric("received_quantity", { precision: 14, scale: 3 }).notNull().default("0"),
  backorderedQuantity: numeric("backordered_quantity", { precision: 14, scale: 3 }).notNull().default("0"),
  approvedSubstitution: text("approved_substitution"),
  promisedDate: date("promised_date", { mode: "string" }),
  scopeReference: text("scope_reference"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("supplier_order_lines_scope_order_idx").on(table.tenantId, table.environmentId, table.orderId),
]);

export const supplierDeliveriesTable = pgTable("supplier_deliveries", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => supplierOrdersTable.id, { onDelete: "cascade" }),
  deliveryNumber: text("delivery_number").notNull(),
  status: text("status").notNull().default("scheduled"),
  appointmentDate: date("appointment_date", { mode: "string" }),
  windowStart: timestamp("window_start", { withTimezone: true }),
  windowEnd: timestamp("window_end", { withTimezone: true }),
  carrier: text("carrier"),
  trackingReference: text("tracking_reference"),
  jobsiteInstructions: text("jobsite_instructions"),
  proofObjectPath: text("proof_object_path"),
  proofFileName: text("proof_file_name"),
  proofContentType: text("proof_content_type"),
  proofFileSize: integer("proof_file_size"),
  recipientName: text("recipient_name"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  notes: text("notes"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("supplier_deliveries_scope_number_idx").on(table.tenantId, table.environmentId, table.deliveryNumber),
  index("supplier_deliveries_scope_order_idx").on(table.tenantId, table.environmentId, table.orderId),
]);

export const supplierDeliveryLinesTable = pgTable("supplier_delivery_lines", {
  id: serial("id").primaryKey(),
  deliveryId: integer("delivery_id").notNull().references(() => supplierDeliveriesTable.id, { onDelete: "cascade" }),
  orderLineId: integer("order_line_id").notNull().references(() => supplierOrderLinesTable.id, { onDelete: "cascade" }),
  quantityDelivered: numeric("quantity_delivered", { precision: 14, scale: 3 }).notNull().default("0"),
  quantityReceived: numeric("quantity_received", { precision: 14, scale: 3 }).notNull().default("0"),
  quantityDamaged: numeric("quantity_damaged", { precision: 14, scale: 3 }).notNull().default("0"),
  quantityShort: numeric("quantity_short", { precision: 14, scale: 3 }).notNull().default("0"),
  quantityReturned: numeric("quantity_returned", { precision: 14, scale: 3 }).notNull().default("0"),
  exceptionNote: text("exception_note"),
  acceptedByUserId: integer("accepted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("supplier_delivery_lines_scope_delivery_idx").on(table.tenantId, table.environmentId, table.deliveryId),
]);

export const supplierInvoicesTable = pgTable("supplier_invoices", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => supplierOrdersTable.id, { onDelete: "cascade" }),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date", { mode: "string" }),
  dueDate: date("due_date", { mode: "string" }),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  retainageAmount: numeric("retainage_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("draft"),
  paymentReference: text("payment_reference"),
  waiverStatus: text("waiver_status").notNull().default("not_required"),
  waiverReference: text("waiver_reference"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  objectPath: text("object_path"),
  notes: text("notes"),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("supplier_invoices_scope_number_idx").on(table.tenantId, table.environmentId, table.invoiceNumber),
  index("supplier_invoices_scope_order_idx").on(table.tenantId, table.environmentId, table.orderId),
]);

export const supplierOrderEventsTable = pgTable("supplier_order_events", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => supplierOrdersTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  details: text("details"),
  visibleToCustomer: text("visible_to_customer").notNull().default("false"),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  ...scopeColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("supplier_order_events_scope_order_idx").on(table.tenantId, table.environmentId, table.orderId, table.createdAt),
]);

export type SupplierVendor = typeof supplierVendorsTable.$inferSelect;
export type SupplierProduct = typeof supplierProductsTable.$inferSelect;
export type SupplierPriceList = typeof supplierPriceListsTable.$inferSelect;
export type SupplierPriceListItem = typeof supplierPriceListItemsTable.$inferSelect;
export type SupplierCustomerTerms = typeof supplierCustomerTermsTable.$inferSelect;
export type SupplierQuote = typeof supplierQuotesTable.$inferSelect;
export type SupplierQuoteLine = typeof supplierQuoteLinesTable.$inferSelect;
export type SupplierOrder = typeof supplierOrdersTable.$inferSelect;
export type SupplierOrderLine = typeof supplierOrderLinesTable.$inferSelect;
export type SupplierDelivery = typeof supplierDeliveriesTable.$inferSelect;
export type SupplierDeliveryLine = typeof supplierDeliveryLinesTable.$inferSelect;
export type SupplierInvoice = typeof supplierInvoicesTable.$inferSelect;
export type SupplierOrderEvent = typeof supplierOrderEventsTable.$inferSelect;