import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import {
  businessCustomersTable,
  db,
  projectCommitmentsTable,
  projectsTable,
  supplierCustomerTermsTable,
  supplierDeliveriesTable,
  supplierDeliveryLinesTable,
  supplierInvoicesTable,
  supplierOrderEventsTable,
  supplierOrderLinesTable,
  supplierOrdersTable,
  supplierPriceListItemsTable,
  supplierPriceListsTable,
  supplierProductsTable,
  supplierQuoteLinesTable,
  supplierQuotesTable,
  supplierVendorsTable,
} from "@workspace/db";
import {
  ConvertSupplierQuoteBody,
  ConvertSupplierQuoteParams,
  CreateSupplierCustomerTermsBody,
  CreateSupplierDeliveryBody,
  CreateSupplierDeliveryParams,
  CreateSupplierInvoiceBody,
  CreateSupplierInvoiceParams,
  CreateSupplierPriceListBody,
  CreateSupplierPriceListItemBody,
  CreateSupplierProductBody,
  CreateSupplierQuoteBody,
  CreateSupplierVendorBody,
  GetSupplierOrderParams,
  GetSupplierQuoteParams,
  GetBusinessCustomerSupplierAccountHistoryParams,
  ListSupplierCustomerTermsResponse,
  ListSupplierOrdersQueryParams,
  ListSupplierProductsQueryParams,
  ListSupplierQuotesQueryParams,
  ListSupplierVendorsResponse,
  ListSupplierPriceListsResponse,
  RecordSupplierReceivingBody,
  RecordSupplierReceivingParams,
  RequestSupplierDeliveryProofUploadBody,
  RequestSupplierDeliveryProofUploadParams,
  CompleteSupplierDeliveryProofUploadParams,
  SupplierOrderStatus,
  UpdateSupplierDeliveryBody,
  UpdateSupplierDeliveryParams,
  UpdateSupplierOrderBody,
  UpdateSupplierOrderParams,
  UpdateSupplierProductBody,
  UpdateSupplierProductParams,
  UpdateSupplierQuoteBody,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { screenStoredDocument } from "../lib/documentScreening";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const maxDeliveryProofSize = 25 * 1024 * 1024;
const deliveryProofUploadRateWindowMs = 60_000;
const deliveryProofUploadRateLimit = 10;
const deliveryProofUploadAttempts = new Map<string, { count: number; resetAt: number }>();
const allowedDeliveryProofContentTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif"]);
const scope = (req: TenantRequest, table: { tenantId: any; environmentId: any }) =>
  and(eq(table.tenantId, req.tenantId!), eq(table.environmentId, req.environmentId!));

const asNumber = (value: string | number | null | undefined) => value == null ? 0 : Number(value);
const dateOnly = (value: Date | string | null | undefined) =>
  value == null ? value : value instanceof Date ? value.toISOString().slice(0, 10) : value;
const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
const money = (value: number) => Math.round(value * 100) / 100;
const sanitizeFileName = (value: string) => value.replace(/[\r\n"]/g, "_").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 255);

function rejectDeliveryProofUploadRate(req: TenantRequest, res: Parameters<Parameters<IRouter["get"]>[1]>[1]) {
  const key = `${req.tenantId}:${req.environmentId}:${req.localUserId ?? req.ip}`;
  const now = Date.now();
  const current = deliveryProofUploadAttempts.get(key);
  if (!current || current.resetAt <= now) {
    deliveryProofUploadAttempts.set(key, { count: 1, resetAt: now + deliveryProofUploadRateWindowMs });
    return false;
  }
  if (current.count >= deliveryProofUploadRateLimit) {
    res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000));
    res.status(429).json({ error: "Too many proof uploads. Try again shortly." });
    return true;
  }
  current.count += 1;
  return false;
}

function badRequest(res: Parameters<Parameters<IRouter["get"]>[1]>[1], message: string) {
  res.status(400).json({ error: message });
}

function notFound(res: Parameters<Parameters<IRouter["get"]>[1]>[1], message = "Record not found") {
  res.status(404).json({ error: message });
}

function serializeVendor(row: typeof supplierVendorsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    leadTimeDays: row.leadTimeDays,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeProduct(row: typeof supplierProductsTable.$inferSelect) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    category: row.category,
    unit: row.unit,
    defaultVendorId: row.defaultVendorId,
    leadTimeDays: row.leadTimeDays,
    unitCost: asNumber(row.unitCost),
    listPrice: asNumber(row.listPrice),
    availableQuantity: asNumber(row.availableQuantity),
    backorderedQuantity: asNumber(row.backorderedQuantity),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeTerms(row: typeof supplierCustomerTermsTable.$inferSelect) {
  return {
    id: row.id,
    businessCustomerId: row.businessCustomerId,
    paymentTerms: row.paymentTerms,
    creditLimit: asNumber(row.creditLimit),
    discountPercent: asNumber(row.discountPercent),
    retainageRequired: asNumber(row.retainageRequired),
    waiverRequired: row.waiverRequired,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializePriceList(row: typeof supplierPriceListsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    businessCustomerId: row.businessCustomerId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializePriceListItem(row: typeof supplierPriceListItemsTable.$inferSelect) {
  return {
    id: row.id,
    priceListId: row.priceListId,
    productId: row.productId,
    unitPrice: asNumber(row.unitPrice),
    minimumQuantity: asNumber(row.minimumQuantity),
    createdAt: row.createdAt,
  };
}

function serializeQuoteLine(row: typeof supplierQuoteLinesTable.$inferSelect) {
  return {
    id: row.id,
    quoteId: row.quoteId,
    productId: row.productId,
    vendorId: row.vendorId,
    description: row.description,
    quantity: asNumber(row.quantity),
    unit: row.unit,
    unitCost: asNumber(row.unitCost),
    unitPrice: asNumber(row.unitPrice),
    approvedSubstitution: row.approvedSubstitution,
    promisedDate: row.promisedDate,
    scopeReference: row.scopeReference,
  };
}

function serializeOrderLine(row: typeof supplierOrderLinesTable.$inferSelect) {
  return {
    id: row.id,
    orderId: row.orderId,
    sourceQuoteLineId: row.sourceQuoteLineId,
    productId: row.productId,
    vendorId: row.vendorId,
    description: row.description,
    quantity: asNumber(row.quantity),
    unit: row.unit,
    unitCost: asNumber(row.unitCost),
    unitPrice: asNumber(row.unitPrice),
    purchasedQuantity: asNumber(row.purchasedQuantity),
    deliveredQuantity: asNumber(row.deliveredQuantity),
    receivedQuantity: asNumber(row.receivedQuantity),
    backorderedQuantity: asNumber(row.backorderedQuantity),
    approvedSubstitution: row.approvedSubstitution,
    promisedDate: row.promisedDate,
    scopeReference: row.scopeReference,
  };
}

function serializeDeliveryLine(row: typeof supplierDeliveryLinesTable.$inferSelect) {
  return {
    id: row.id,
    deliveryId: row.deliveryId,
    orderLineId: row.orderLineId,
    quantityDelivered: asNumber(row.quantityDelivered),
    quantityReceived: asNumber(row.quantityReceived),
    quantityDamaged: asNumber(row.quantityDamaged),
    quantityShort: asNumber(row.quantityShort),
    quantityReturned: asNumber(row.quantityReturned),
    exceptionNote: row.exceptionNote,
    acceptedByUserId: row.acceptedByUserId,
    createdAt: row.createdAt,
  };
}

function serializeDelivery(row: typeof supplierDeliveriesTable.$inferSelect, lines: typeof supplierDeliveryLinesTable.$inferSelect[] = []) {
  return {
    id: row.id,
    orderId: row.orderId,
    deliveryNumber: row.deliveryNumber,
    status: row.status,
    appointmentDate: row.appointmentDate,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    carrier: row.carrier,
    trackingReference: row.trackingReference,
    jobsiteInstructions: row.jobsiteInstructions,
    proofObjectPath: row.proofObjectPath,
    proofFileName: row.proofFileName,
    proofContentType: row.proofContentType,
    proofFileSize: row.proofFileSize,
    recipientName: row.recipientName,
    deliveredAt: row.deliveredAt,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lines: lines.map(serializeDeliveryLine),
  };
}

function serializeInvoice(row: typeof supplierInvoicesTable.$inferSelect) {
  return {
    id: row.id,
    orderId: row.orderId,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate,
    subtotal: asNumber(row.subtotal),
    retainageAmount: asNumber(row.retainageAmount),
    totalAmount: asNumber(row.totalAmount),
    paidAmount: asNumber(row.paidAmount),
    status: row.status,
    paymentReference: row.paymentReference,
    waiverStatus: row.waiverStatus,
    waiverReference: row.waiverReference,
    paidAt: row.paidAt,
    objectPath: row.objectPath,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeEvent(row: typeof supplierOrderEventsTable.$inferSelect) {
  return {
    id: row.id,
    orderId: row.orderId,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    details: row.details,
    visibleToCustomer: row.visibleToCustomer === "true",
    actorUserId: row.actorUserId,
    createdAt: row.createdAt,
  };
}

function buildPaymentGate(
  invoice: typeof supplierInvoicesTable.$inferSelect,
  terms: typeof supplierCustomerTermsTable.$inferSelect | undefined,
) {
  const retainageRequired = asNumber(terms?.retainageRequired);
  const waiverRequired = terms?.waiverRequired === true;
  const reasons: string[] = [];
  if (retainageRequired > 0 && asNumber(invoice.retainageAmount) <= 0) {
    reasons.push(`Retainage of ${retainageRequired}% must be recorded before payment`);
  }
  if (waiverRequired && !["received", "approved"].includes(invoice.waiverStatus)) {
    reasons.push(`Waiver is ${invoice.waiverStatus.replaceAll("_", " ")} and must be approved before payment`);
  }
  return {
    status: reasons.length ? "blocked" as const : "ready" as const,
    retainageRequired,
    waiverRequired,
    waiverStatus: invoice.waiverStatus,
    reasons,
  };
}

async function updateLinkedCommitmentTotals(req: TenantRequest, orderId: number) {
  const [order] = await db.select({
    linkedCommitmentId: supplierOrdersTable.linkedCommitmentId,
  }).from(supplierOrdersTable).where(and(
    eq(supplierOrdersTable.id, orderId),
    scope(req, supplierOrdersTable),
  ));
  if (!order?.linkedCommitmentId) return;
  const invoiceRows = await db.select({
    totalAmount: supplierInvoicesTable.totalAmount,
    paidAmount: supplierInvoicesTable.paidAmount,
  }).from(supplierInvoicesTable)
    .innerJoin(supplierOrdersTable, eq(supplierInvoicesTable.orderId, supplierOrdersTable.id))
    .where(and(
      eq(supplierOrdersTable.linkedCommitmentId, order.linkedCommitmentId),
      scope(req, supplierInvoicesTable),
      scope(req, supplierOrdersTable),
    ));
  const invoicedValue = invoiceRows.reduce((sum, row) => sum + asNumber(row.totalAmount), 0);
  const paidValue = invoiceRows.reduce((sum, row) => sum + asNumber(row.paidAmount), 0);
  await db.update(projectCommitmentsTable).set({
    invoicedValue: String(money(invoicedValue)),
    paidValue: String(money(paidValue)),
    updatedAt: new Date(),
  }).where(and(
    eq(projectCommitmentsTable.id, order.linkedCommitmentId),
    scope(req, projectCommitmentsTable),
  ));
}

async function getSupplierTerms(req: TenantRequest, businessCustomerId: number) {
  const [terms] = await db.select().from(supplierCustomerTermsTable).where(and(
    eq(supplierCustomerTermsTable.businessCustomerId, businessCustomerId),
    scope(req, supplierCustomerTermsTable),
    eq(supplierCustomerTermsTable.status, "active"),
  ));
  return terms;
}

async function requireCustomer(req: TenantRequest, businessCustomerId: number) {
  const [customer] = await db.select().from(businessCustomersTable).where(and(
    eq(businessCustomersTable.id, businessCustomerId),
    eq(businessCustomersTable.tenantId, req.tenantId!),
    eq(businessCustomersTable.environmentId, req.environmentId!),
    eq(businessCustomersTable.status, "active"),
  ));
  return customer;
}

async function getQuote(req: TenantRequest, quoteId: number) {
  const [row] = await db.select({
    quote: supplierQuotesTable,
    customerName: businessCustomersTable.companyName,
  }).from(supplierQuotesTable)
    .innerJoin(businessCustomersTable, eq(supplierQuotesTable.businessCustomerId, businessCustomersTable.id))
    .where(and(
      eq(supplierQuotesTable.id, quoteId),
      scope(req, supplierQuotesTable),
      eq(businessCustomersTable.tenantId, req.tenantId!),
      eq(businessCustomersTable.environmentId, req.environmentId!),
    ));
  return row;
}

async function getOrder(req: TenantRequest, orderId: number) {
  const [row] = await db.select({
    order: supplierOrdersTable,
    customerName: businessCustomersTable.companyName,
  }).from(supplierOrdersTable)
    .innerJoin(businessCustomersTable, eq(supplierOrdersTable.businessCustomerId, businessCustomersTable.id))
    .where(and(
      eq(supplierOrdersTable.id, orderId),
      scope(req, supplierOrdersTable),
      eq(businessCustomersTable.tenantId, req.tenantId!),
      eq(businessCustomersTable.environmentId, req.environmentId!),
    ));
  return row;
}

async function serializeQuoteDetail(req: TenantRequest, quoteId: number) {
  const row = await getQuote(req, quoteId);
  if (!row) return null;
  const lines = await db.select().from(supplierQuoteLinesTable).where(and(
    eq(supplierQuoteLinesTable.quoteId, quoteId),
    scope(req, supplierQuoteLinesTable),
  )).orderBy(asc(supplierQuoteLinesTable.id));
  return {
    id: row.quote.id,
    quoteNumber: row.quote.quoteNumber,
    businessCustomerId: row.quote.businessCustomerId,
    customerName: row.customerName,
    projectId: row.quote.projectId,
    bidId: row.quote.bidId,
    estimateId: row.quote.estimateId,
    proposalId: row.quote.proposalId,
    status: row.quote.status,
    quoteDate: row.quote.quoteDate,
    validUntil: row.quote.validUntil,
    notes: row.quote.notes,
    subtotal: asNumber(row.quote.subtotal),
    totalCost: asNumber(row.quote.totalCost),
    totalSell: asNumber(row.quote.totalSell),
    grossMargin: asNumber(row.quote.grossMargin),
    createdAt: row.quote.createdAt,
    updatedAt: row.quote.updatedAt,
    lines: lines.map(serializeQuoteLine),
  };
}

async function serializeOrderDetail(req: TenantRequest, orderId: number) {
  const row = await getOrder(req, orderId);
  if (!row) return null;
  const [lines, deliveries, invoices] = await Promise.all([
    db.select().from(supplierOrderLinesTable).where(and(
      eq(supplierOrderLinesTable.orderId, orderId),
      scope(req, supplierOrderLinesTable),
    )).orderBy(asc(supplierOrderLinesTable.id)),
    db.select().from(supplierDeliveriesTable).where(and(
      eq(supplierDeliveriesTable.orderId, orderId),
      scope(req, supplierDeliveriesTable),
    )).orderBy(desc(supplierDeliveriesTable.createdAt)),
    db.select().from(supplierInvoicesTable).where(and(
      eq(supplierInvoicesTable.orderId, orderId),
      scope(req, supplierInvoicesTable),
    )).orderBy(desc(supplierInvoicesTable.createdAt)),
  ]);
  const deliveryLines = deliveries.length
    ? await db.select().from(supplierDeliveryLinesTable).where(and(
      scope(req, supplierDeliveryLinesTable),
      or(...deliveries.map((delivery) => eq(supplierDeliveryLinesTable.deliveryId, delivery.id)))!,
    )).orderBy(asc(supplierDeliveryLinesTable.id))
    : [];
  return {
    id: row.order.id,
    orderNumber: row.order.orderNumber,
    businessCustomerId: row.order.businessCustomerId,
    customerName: row.customerName,
    projectId: row.order.projectId,
    bidId: row.order.bidId,
    estimateId: row.order.estimateId,
    proposalId: row.order.proposalId,
    sourceQuoteId: row.order.sourceQuoteId,
    orderStatus: row.order.orderStatus,
    paymentStatus: row.order.paymentStatus,
    orderDate: row.order.orderDate,
    promisedDate: row.order.promisedDate,
    subtotal: asNumber(row.order.subtotal),
    totalCost: asNumber(row.order.totalCost),
    totalSell: asNumber(row.order.totalSell),
    grossMargin: asNumber(row.order.grossMargin),
    jobsiteInstructions: row.order.jobsiteInstructions,
    customerVisibleStatus: row.order.customerVisibleStatus,
    createdAt: row.order.createdAt,
    updatedAt: row.order.updatedAt,
    lines: lines.map(serializeOrderLine),
    deliveries: deliveries.map((delivery) => serializeDelivery(delivery, deliveryLines.filter((line) => line.deliveryId === delivery.id))),
    invoices: invoices.map(serializeInvoice),
  };
}

async function audit(req: TenantRequest, orderId: number, entityType: string, entityId: number, action: string, fromStatus?: string | null, toStatus?: string | null, details?: string) {
  await db.insert(supplierOrderEventsTable).values({
    orderId,
    entityType,
    entityId,
    action,
    fromStatus: fromStatus ?? null,
    toStatus: toStatus ?? null,
    details: details ?? null,
    visibleToCustomer: "true",
    actorUserId: req.localUserId ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  });
}

async function updateOrderFulfillment(req: TenantRequest, orderId: number) {
  const lines = await db.select().from(supplierOrderLinesTable).where(and(
    eq(supplierOrderLinesTable.orderId, orderId),
    scope(req, supplierOrderLinesTable),
  ));
  if (!lines.length) return;
  const allDelivered = lines.every((line) => asNumber(line.deliveredQuantity) >= asNumber(line.quantity));
  const anyDelivered = lines.some((line) => asNumber(line.deliveredQuantity) > 0);
  const [order] = await db.select({ orderStatus: supplierOrdersTable.orderStatus }).from(supplierOrdersTable).where(and(
    eq(supplierOrdersTable.id, orderId),
    scope(req, supplierOrdersTable),
  ));
  if (!order || ["closed", "canceled"].includes(order.orderStatus)) return;
  const nextStatus = allDelivered ? "fulfilled" : anyDelivered ? "partially_fulfilled" : order.orderStatus;
  if (nextStatus !== order.orderStatus) {
    await db.update(supplierOrdersTable).set({
      orderStatus: nextStatus,
      customerVisibleStatus: nextStatus === "fulfilled" ? "fulfilled" : "partially_fulfilled",
      updatedAt: new Date(),
    }).where(and(eq(supplierOrdersTable.id, orderId), scope(req, supplierOrdersTable)));
    await audit(req, orderId, "order", orderId, "fulfillment_status_changed", order.orderStatus, nextStatus);
  }
}

router.get("/supplier-products", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = ListSupplierProductsQueryParams.safeParse({
    search: req.query.search,
    status: req.query.status,
  });
  if (!parsed.success) { badRequest(res, "Invalid supplier product filters"); return; }
  const conditions = [scope(req, supplierProductsTable)];
  if (parsed.data.status) conditions.push(eq(supplierProductsTable.status, parsed.data.status));
  if (parsed.data.search) {
    const term = `%${parsed.data.search}%`;
    conditions.push(or(
      ilike(supplierProductsTable.sku, term),
      ilike(supplierProductsTable.name, term),
      ilike(supplierProductsTable.category, term),
    )!);
  }
  const rows = await db.select().from(supplierProductsTable).where(and(...conditions)).orderBy(asc(supplierProductsTable.name));
  res.json(rows.map(serializeProduct));
});

router.post("/supplier-products", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateSupplierProductBody.safeParse(req.body);
  if (!parsed.success) { badRequest(res, "Invalid supplier product"); return; }
  if (parsed.data.defaultVendorId != null) {
    const [vendor] = await db.select({ id: supplierVendorsTable.id }).from(supplierVendorsTable).where(and(
      eq(supplierVendorsTable.id, parsed.data.defaultVendorId),
      scope(req, supplierVendorsTable),
    ));
    if (!vendor) { badRequest(res, "Default vendor is outside the active environment"); return; }
  }
  try {
    const [row] = await db.insert(supplierProductsTable).values({
      sku: parsed.data.sku.trim(),
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() ?? null,
      category: parsed.data.category?.trim() || "material",
      unit: parsed.data.unit?.trim() || "each",
      defaultVendorId: parsed.data.defaultVendorId ?? null,
      leadTimeDays: parsed.data.leadTimeDays ?? 0,
      unitCost: String(parsed.data.unitCost ?? 0),
      listPrice: String(parsed.data.listPrice ?? 0),
      availableQuantity: String(parsed.data.availableQuantity ?? 0),
      backorderedQuantity: String(parsed.data.backorderedQuantity ?? 0),
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    }).returning();
    res.status(201).json(serializeProduct(row));
  } catch (error) {
    req.log?.warn({ err: error }, "supplier product create failed");
    res.status(409).json({ error: "A product with this SKU already exists in the active environment" });
  }
});

router.patch("/supplier-products/:productId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = UpdateSupplierProductBody.safeParse(req.body);
  const path = UpdateSupplierProductParams.safeParse(req.params);
  if (!params.success || !path.success) { badRequest(res, "Invalid supplier product update"); return; }
  const productId = Number(req.params.productId);
  if (params.data.defaultVendorId != null) {
    const [vendor] = await db.select({ id: supplierVendorsTable.id }).from(supplierVendorsTable).where(and(
      eq(supplierVendorsTable.id, params.data.defaultVendorId),
      scope(req, supplierVendorsTable),
    ));
    if (!vendor) { badRequest(res, "Default vendor is outside the active environment"); return; }
  }
  const [existing] = await db.select().from(supplierProductsTable).where(and(
    eq(supplierProductsTable.id, productId),
    scope(req, supplierProductsTable),
  ));
  if (!existing) { notFound(res, "Supplier product not found"); return; }
  const [row] = await db.update(supplierProductsTable).set({
    ...(params.data.sku === undefined ? {} : { sku: params.data.sku.trim() }),
    ...(params.data.name === undefined ? {} : { name: params.data.name.trim() }),
    ...(params.data.description === undefined ? {} : { description: params.data.description?.trim() ?? null }),
    ...(params.data.category === undefined ? {} : { category: params.data.category.trim() }),
    ...(params.data.unit === undefined ? {} : { unit: params.data.unit.trim() }),
    ...(params.data.defaultVendorId === undefined ? {} : { defaultVendorId: params.data.defaultVendorId }),
    ...(params.data.leadTimeDays === undefined ? {} : { leadTimeDays: params.data.leadTimeDays }),
    ...(params.data.unitCost === undefined ? {} : { unitCost: String(params.data.unitCost) }),
    ...(params.data.listPrice === undefined ? {} : { listPrice: String(params.data.listPrice) }),
    ...(params.data.availableQuantity === undefined ? {} : { availableQuantity: String(params.data.availableQuantity) }),
    ...(params.data.backorderedQuantity === undefined ? {} : { backorderedQuantity: String(params.data.backorderedQuantity) }),
    ...(params.data.status === undefined ? {} : { status: params.data.status }),
    updatedAt: new Date(),
  }).where(and(eq(supplierProductsTable.id, productId), scope(req, supplierProductsTable))).returning();
  res.json(serializeProduct(row));
});

router.get("/supplier-vendors", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const rows = await db.select().from(supplierVendorsTable).where(scope(req, supplierVendorsTable)).orderBy(asc(supplierVendorsTable.name));
  res.json(rows.map(serializeVendor));
});

router.post("/supplier-vendors", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateSupplierVendorBody.safeParse(req.body);
  if (!parsed.success) { badRequest(res, "Invalid supplier vendor"); return; }
  try {
    const [row] = await db.insert(supplierVendorsTable).values({
      name: parsed.data.name.trim(),
      normalizedName: normalize(parsed.data.name),
      contactName: parsed.data.contactName?.trim() ?? null,
      email: parsed.data.email?.trim().toLowerCase() ?? null,
      phone: parsed.data.phone?.trim() ?? null,
      leadTimeDays: parsed.data.leadTimeDays ?? 0,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    }).returning();
    res.status(201).json(serializeVendor(row));
  } catch (error) {
    req.log?.warn({ err: error }, "supplier vendor create failed");
    res.status(409).json({ error: "A vendor with this name already exists in the active environment" });
  }
});

router.get("/supplier-customer-terms", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const rows = await db.select().from(supplierCustomerTermsTable).where(scope(req, supplierCustomerTermsTable)).orderBy(desc(supplierCustomerTermsTable.updatedAt));
  res.json(rows.map(serializeTerms));
});

router.post("/supplier-customer-terms", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateSupplierCustomerTermsBody.safeParse(req.body);
  if (!parsed.success) { badRequest(res, "Invalid supplier customer terms"); return; }
  if (!await requireCustomer(req, parsed.data.businessCustomerId)) { badRequest(res, "Customer is outside the active environment"); return; }
  const [row] = await db.insert(supplierCustomerTermsTable).values({
    businessCustomerId: parsed.data.businessCustomerId,
    paymentTerms: parsed.data.paymentTerms?.trim() || "Net 30",
    creditLimit: String(parsed.data.creditLimit ?? 0),
    discountPercent: String(parsed.data.discountPercent ?? 0),
    retainageRequired: String(parsed.data.retainageRequired ?? 0),
    waiverRequired: parsed.data.waiverRequired ?? false,
    status: parsed.data.status ?? "active",
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).onConflictDoUpdate({
    target: [supplierCustomerTermsTable.tenantId, supplierCustomerTermsTable.environmentId, supplierCustomerTermsTable.businessCustomerId],
    set: {
      paymentTerms: parsed.data.paymentTerms?.trim() || "Net 30",
      creditLimit: String(parsed.data.creditLimit ?? 0),
      discountPercent: String(parsed.data.discountPercent ?? 0),
      retainageRequired: String(parsed.data.retainageRequired ?? 0),
      waiverRequired: parsed.data.waiverRequired ?? false,
      status: parsed.data.status ?? "active",
      updatedAt: new Date(),
    },
  }).returning();
  res.status(201).json(serializeTerms(row));
});

router.get("/business-customers/:customerId/supplier-account-history", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = GetBusinessCustomerSupplierAccountHistoryParams.safeParse(req.params);
  if (!params.success) { badRequest(res, "Invalid business customer"); return; }
  const customer = await requireCustomer(req, params.data.customerId);
  if (!customer) { notFound(res, "Business customer not found"); return; }
  const terms = await getSupplierTerms(req, params.data.customerId);
  const orderRows = await db.select({
    order: supplierOrdersTable,
    projectName: projectsTable.projectName,
    commitmentNumber: projectCommitmentsTable.commitmentNumber,
  }).from(supplierOrdersTable)
    .leftJoin(projectsTable, and(
      eq(projectsTable.id, supplierOrdersTable.projectId),
      eq(projectsTable.tenantId, req.tenantId!),
      eq(projectsTable.environmentId, req.environmentId!),
    ))
    .leftJoin(projectCommitmentsTable, and(
      eq(projectCommitmentsTable.id, supplierOrdersTable.linkedCommitmentId),
      eq(projectCommitmentsTable.tenantId, req.tenantId!),
      eq(projectCommitmentsTable.environmentId, req.environmentId!),
    ))
    .where(and(
      eq(supplierOrdersTable.businessCustomerId, params.data.customerId),
      scope(req, supplierOrdersTable),
    ))
    .orderBy(desc(supplierOrdersTable.updatedAt));

  let invoicedAmount = 0;
  let paidAmount = 0;
  let outstandingAmount = 0;
  let retainageHeld = 0;
  let payableAmount = 0;
  let blockedAmount = 0;
  let invoiceCount = 0;
  const orders = await Promise.all(orderRows.map(async (row) => {
    const invoices = await db.select().from(supplierInvoicesTable).where(and(
      eq(supplierInvoicesTable.orderId, row.order.id),
      scope(req, supplierInvoicesTable),
    )).orderBy(desc(supplierInvoicesTable.createdAt));
    const accountInvoices = invoices.map((invoice) => {
      const total = asNumber(invoice.totalAmount);
      const paid = asNumber(invoice.paidAmount);
      const retainage = asNumber(invoice.retainageAmount);
      const outstanding = Math.max(total - paid, 0);
      const payable = Math.max(total - retainage - paid, 0);
      const paymentGate = buildPaymentGate(invoice, terms);
      invoicedAmount += total;
      paidAmount += paid;
      outstandingAmount += outstanding;
      retainageHeld += retainage;
      payableAmount += payable;
      if (paymentGate.status === "blocked") blockedAmount += payable;
      invoiceCount += 1;
      return {
        ...serializeInvoice(invoice),
        outstandingAmount: money(outstanding),
        payableAmount: money(payable),
        paymentGate,
        projectId: row.order.projectId,
        projectName: row.projectName,
        commitmentId: row.order.linkedCommitmentId,
        commitmentNumber: row.commitmentNumber,
      };
    });
    return {
      orderId: row.order.id,
      orderNumber: row.order.orderNumber,
      orderStatus: row.order.orderStatus,
      paymentStatus: row.order.paymentStatus,
      totalSell: asNumber(row.order.totalSell),
      projectId: row.order.projectId,
      projectName: row.projectName,
      commitmentId: row.order.linkedCommitmentId,
      commitmentNumber: row.commitmentNumber,
      invoices: accountInvoices,
    };
  }));
  const orderIds = orderRows.map((row) => row.order.id);
  const paymentEvents = orderIds.length ? await db.select().from(supplierOrderEventsTable).where(and(
    inArray(supplierOrderEventsTable.orderId, orderIds),
    scope(req, supplierOrderEventsTable),
    eq(supplierOrderEventsTable.visibleToCustomer, "true"),
    or(eq(supplierOrderEventsTable.action, "payment_recorded"), eq(supplierOrderEventsTable.action, "invoice_recorded")),
  )).orderBy(desc(supplierOrderEventsTable.createdAt)) : [];

  res.json({
    customerId: customer.id,
    customerName: customer.companyName,
    terms: terms ? serializeTerms(terms) : null,
    summary: {
      orderCount: orders.length,
      invoiceCount,
      invoicedAmount: money(invoicedAmount),
      paidAmount: money(paidAmount),
      outstandingAmount: money(outstandingAmount),
      retainageHeld: money(retainageHeld),
      payableAmount: money(payableAmount),
      blockedAmount: money(blockedAmount),
    },
    orders,
    paymentEvents: paymentEvents.map(serializeEvent),
  });
});

router.get("/supplier-price-lists", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const lists = await db.select().from(supplierPriceListsTable).where(scope(req, supplierPriceListsTable)).orderBy(desc(supplierPriceListsTable.updatedAt));
  const result = await Promise.all(lists.map(async (list) => {
    const items = await db.select().from(supplierPriceListItemsTable).where(and(
      eq(supplierPriceListItemsTable.priceListId, list.id),
      scope(req, supplierPriceListItemsTable),
    ));
    return { ...serializePriceList(list), items: items.map(serializePriceListItem) };
  }));
  res.json(result);
});

router.post("/supplier-price-lists", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateSupplierPriceListBody.safeParse(req.body);
  if (!parsed.success) { badRequest(res, "Invalid supplier price list"); return; }
  if (parsed.data.businessCustomerId != null && !await requireCustomer(req, parsed.data.businessCustomerId)) {
    badRequest(res, "Customer is outside the active environment"); return;
  }
  const [row] = await db.insert(supplierPriceListsTable).values({
    name: parsed.data.name.trim(),
    businessCustomerId: parsed.data.businessCustomerId ?? null,
    effectiveFrom: dateOnly(parsed.data.effectiveFrom),
    effectiveTo: dateOnly(parsed.data.effectiveTo),
    status: parsed.data.status ?? "active",
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  res.status(201).json({ ...serializePriceList(row), items: [] });
});

router.post("/supplier-price-lists/:priceListId/items", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateSupplierPriceListItemBody.safeParse(req.body);
  const priceListId = Number(req.params.priceListId);
  if (!parsed.success || !Number.isInteger(priceListId)) { badRequest(res, "Invalid supplier price list item"); return; }
  const [list] = await db.select({ id: supplierPriceListsTable.id }).from(supplierPriceListsTable).where(and(
    eq(supplierPriceListsTable.id, priceListId),
    scope(req, supplierPriceListsTable),
  ));
  const [product] = await db.select({ id: supplierProductsTable.id }).from(supplierProductsTable).where(and(
    eq(supplierProductsTable.id, parsed.data.productId),
    scope(req, supplierProductsTable),
  ));
  if (!list || !product) { badRequest(res, "Price list or product is outside the active environment"); return; }
  const [row] = await db.insert(supplierPriceListItemsTable).values({
    priceListId,
    productId: parsed.data.productId,
    unitPrice: String(parsed.data.unitPrice),
    minimumQuantity: String(parsed.data.minimumQuantity ?? 1),
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).onConflictDoUpdate({
    target: [
      supplierPriceListItemsTable.tenantId,
      supplierPriceListItemsTable.environmentId,
      supplierPriceListItemsTable.priceListId,
      supplierPriceListItemsTable.productId,
    ],
    set: {
      unitPrice: String(parsed.data.unitPrice),
      minimumQuantity: String(parsed.data.minimumQuantity ?? 1),
    },
  }).returning();
  res.status(201).json(serializePriceListItem(row));
});

router.get("/supplier-quotes", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = ListSupplierQuotesQueryParams.safeParse({
    status: req.query.status,
    businessCustomerId: req.query.businessCustomerId,
  });
  if (!parsed.success) { badRequest(res, "Invalid supplier quote filters"); return; }
  const conditions = [scope(req, supplierQuotesTable)];
  if (parsed.data.status) conditions.push(eq(supplierQuotesTable.status, parsed.data.status));
  if (parsed.data.businessCustomerId != null) conditions.push(eq(supplierQuotesTable.businessCustomerId, parsed.data.businessCustomerId));
  const rows = await db.select({
    quote: supplierQuotesTable,
    customerName: businessCustomersTable.companyName,
  }).from(supplierQuotesTable)
    .innerJoin(businessCustomersTable, eq(supplierQuotesTable.businessCustomerId, businessCustomersTable.id))
    .where(and(...conditions, eq(businessCustomersTable.tenantId, req.tenantId!), eq(businessCustomersTable.environmentId, req.environmentId!)))
    .orderBy(desc(supplierQuotesTable.updatedAt));
  res.json(rows.map(({ quote, customerName }) => ({
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    businessCustomerId: quote.businessCustomerId,
    customerName,
    projectId: quote.projectId,
    bidId: quote.bidId,
    estimateId: quote.estimateId,
    proposalId: quote.proposalId,
    status: quote.status,
    quoteDate: quote.quoteDate,
    validUntil: quote.validUntil,
    notes: quote.notes,
    subtotal: asNumber(quote.subtotal),
    totalCost: asNumber(quote.totalCost),
    totalSell: asNumber(quote.totalSell),
    grossMargin: asNumber(quote.grossMargin),
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
  })));
});

router.post("/supplier-quotes", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = CreateSupplierQuoteBody.safeParse(req.body);
  if (!parsed.success) { badRequest(res, "Invalid supplier quote"); return; }
  if (!await requireCustomer(req, parsed.data.businessCustomerId)) { badRequest(res, "Customer is outside the active environment"); return; }
  const totalCost = money(parsed.data.lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0));
  const totalSell = money(parsed.data.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  const quoteNumber = `SQ-${Date.now()}-${req.tenantId}`;
  const quote = await db.transaction(async (tx) => {
    const [created] = await tx.insert(supplierQuotesTable).values({
      quoteNumber,
      businessCustomerId: parsed.data.businessCustomerId,
      projectId: parsed.data.projectId ?? null,
      bidId: parsed.data.bidId ?? null,
      estimateId: parsed.data.estimateId ?? null,
      proposalId: parsed.data.proposalId ?? null,
      status: parsed.data.status ?? "draft",
      quoteDate: dateOnly(parsed.data.quoteDate) ?? new Date().toISOString().slice(0, 10),
      validUntil: dateOnly(parsed.data.validUntil) ?? null,
      notes: parsed.data.notes?.trim() ?? null,
      subtotal: String(totalSell),
      totalCost: String(totalCost),
      totalSell: String(totalSell),
      grossMargin: String(money(totalSell - totalCost)),
      ownerUserId: req.localUserId ?? null,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    }).returning();
    await tx.insert(supplierQuoteLinesTable).values(parsed.data.lines.map((line) => ({
      quoteId: created.id,
      productId: line.productId ?? null,
      vendorId: line.vendorId ?? null,
      description: line.description.trim(),
      quantity: String(line.quantity),
      unit: line.unit?.trim() || "each",
      unitCost: String(line.unitCost),
      unitPrice: String(line.unitPrice),
      approvedSubstitution: line.approvedSubstitution?.trim() ?? null,
      promisedDate: dateOnly(line.promisedDate) ?? null,
      scopeReference: line.scopeReference?.trim() ?? null,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    })));
    return created;
  });
  const detail = await serializeQuoteDetail(req, quote.id);
  res.status(201).json(detail);
});

router.get("/supplier-quotes/:quoteId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = GetSupplierQuoteParams.safeParse(req.params);
  if (!params.success) { badRequest(res, "Invalid supplier quote"); return; }
  const detail = await serializeQuoteDetail(req, params.data.quoteId);
  if (!detail) { notFound(res, "Supplier quote not found"); return; }
  res.json(detail);
});

router.patch("/supplier-quotes/:quoteId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = GetSupplierQuoteParams.safeParse(req.params);
  const parsed = UpdateSupplierQuoteBody.safeParse(req.body);
  if (!params.success || !parsed.success) { badRequest(res, "Invalid supplier quote"); return; }
  const existing = await getQuote(req, params.data.quoteId);
  if (!existing) { notFound(res, "Supplier quote not found"); return; }
  if (!["draft", "sent"].includes(existing.quote.status)) {
    badRequest(res, "Only draft or sent supplier quotes can be edited");
    return;
  }
  if (parsed.data.status && !["draft", "sent"].includes(parsed.data.status)) {
    badRequest(res, "Only draft or sent supplier quotes can be saved");
    return;
  }
  if (!await requireCustomer(req, parsed.data.businessCustomerId)) {
    badRequest(res, "Customer is outside the active environment");
    return;
  }
  const totalCost = money(parsed.data.lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0));
  const totalSell = money(parsed.data.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
  await db.transaction(async (tx) => {
    await tx.update(supplierQuotesTable).set({
      businessCustomerId: parsed.data.businessCustomerId,
      projectId: parsed.data.projectId ?? existing.quote.projectId,
      bidId: parsed.data.bidId ?? existing.quote.bidId,
      estimateId: parsed.data.estimateId ?? existing.quote.estimateId,
      proposalId: parsed.data.proposalId ?? existing.quote.proposalId,
      status: parsed.data.status ?? existing.quote.status,
      quoteDate: dateOnly(parsed.data.quoteDate) ?? existing.quote.quoteDate,
      validUntil: dateOnly(parsed.data.validUntil) ?? existing.quote.validUntil,
      notes: parsed.data.notes?.trim() ?? existing.quote.notes,
      subtotal: String(totalSell),
      totalCost: String(totalCost),
      totalSell: String(totalSell),
      grossMargin: String(money(totalSell - totalCost)),
      updatedAt: new Date(),
    }).where(and(
      eq(supplierQuotesTable.id, existing.quote.id),
      scope(req, supplierQuotesTable),
    ));
    await tx.delete(supplierQuoteLinesTable).where(and(
      eq(supplierQuoteLinesTable.quoteId, existing.quote.id),
      scope(req, supplierQuoteLinesTable),
    ));
    await tx.insert(supplierQuoteLinesTable).values(parsed.data.lines.map((line) => ({
      quoteId: existing.quote.id,
      productId: line.productId ?? null,
      vendorId: line.vendorId ?? null,
      description: line.description.trim(),
      quantity: String(line.quantity),
      unit: line.unit?.trim() || "each",
      unitCost: String(line.unitCost),
      unitPrice: String(line.unitPrice),
      approvedSubstitution: line.approvedSubstitution?.trim() ?? null,
      promisedDate: dateOnly(line.promisedDate) ?? null,
      scopeReference: line.scopeReference?.trim() ?? null,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    })));
  });
  const detail = await serializeQuoteDetail(req, existing.quote.id);
  res.json(detail);
});

router.post("/supplier-quotes/:quoteId/convert", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = ConvertSupplierQuoteParams.safeParse(req.params);
  const parsed = ConvertSupplierQuoteBody.safeParse(req.body);
  if (!params.success || !parsed.success) { badRequest(res, "Invalid supplier quote conversion"); return; }
  const quoteRow = await getQuote(req, params.data.quoteId);
  if (!quoteRow) { notFound(res, "Supplier quote not found"); return; }
  if (quoteRow.quote.status !== "accepted") { badRequest(res, "Only an accepted supplier quote can be converted"); return; }
  const [existingOrder] = await db.select({ id: supplierOrdersTable.id }).from(supplierOrdersTable).where(and(
    eq(supplierOrdersTable.sourceQuoteId, params.data.quoteId),
    scope(req, supplierOrdersTable),
  ));
  if (existingOrder) { badRequest(res, "This supplier quote has already been converted"); return; }
  const lines = await db.select().from(supplierQuoteLinesTable).where(and(
    eq(supplierQuoteLinesTable.quoteId, params.data.quoteId),
    scope(req, supplierQuoteLinesTable),
  )).orderBy(asc(supplierQuoteLinesTable.id));
  if (!lines.length) { badRequest(res, "Supplier quote has no lines"); return; }
  const order = await db.transaction(async (tx) => {
    const orderNumber = `PO-${quoteRow.quote.quoteNumber}`;
    const [created] = await tx.insert(supplierOrdersTable).values({
      orderNumber,
      businessCustomerId: quoteRow.quote.businessCustomerId,
      projectId: quoteRow.quote.projectId,
      bidId: quoteRow.quote.bidId,
      estimateId: quoteRow.quote.estimateId,
      proposalId: quoteRow.quote.proposalId,
      sourceQuoteId: quoteRow.quote.id,
      linkedCommitmentId: parsed.data.linkedCommitmentId ?? null,
      linkedSubmittalPackageId: parsed.data.linkedSubmittalPackageId ?? null,
      orderStatus: "approved",
      paymentStatus: "unbilled",
      orderDate: dateOnly(parsed.data.orderDate) ?? new Date().toISOString().slice(0, 10),
      promisedDate: dateOnly(parsed.data.promisedDate) ?? lines.map((line) => line.promisedDate).filter(Boolean).sort()[0] ?? null,
      subtotal: quoteRow.quote.subtotal,
      totalCost: quoteRow.quote.totalCost,
      totalSell: quoteRow.quote.totalSell,
      grossMargin: quoteRow.quote.grossMargin,
      jobsiteInstructions: parsed.data.jobsiteInstructions?.trim() ?? null,
      customerVisibleStatus: "order_received",
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    }).returning();
    await tx.insert(supplierOrderLinesTable).values(lines.map((line) => ({
      orderId: created.id,
      sourceQuoteLineId: line.id,
      productId: line.productId,
      vendorId: line.vendorId,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitCost: line.unitCost,
      unitPrice: line.unitPrice,
      purchasedQuantity: "0",
      deliveredQuantity: "0",
      receivedQuantity: "0",
      backorderedQuantity: line.quantity,
      approvedSubstitution: line.approvedSubstitution,
      promisedDate: line.promisedDate,
      scopeReference: line.scopeReference,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    })));
    await tx.update(supplierQuotesTable).set({ status: "converted", updatedAt: new Date() }).where(and(
      eq(supplierQuotesTable.id, quoteRow.quote.id),
      scope(req, supplierQuotesTable),
    ));
    await tx.insert(supplierOrderEventsTable).values({
      orderId: created.id,
      entityType: "quote",
      entityId: quoteRow.quote.id,
      action: "converted_to_order",
      fromStatus: "accepted",
      toStatus: "approved",
      details: "Accepted supplier quote converted into a purchase order",
      visibleToCustomer: "true",
      actorUserId: req.localUserId ?? null,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    });
    return created;
  });
  const detail = await serializeOrderDetail(req, order.id);
  res.status(201).json(detail);
});

router.get("/supplier-orders", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const parsed = ListSupplierOrdersQueryParams.safeParse({
    orderStatus: req.query.orderStatus,
    businessCustomerId: req.query.businessCustomerId,
    projectId: req.query.projectId,
  });
  if (!parsed.success) { badRequest(res, "Invalid supplier order filters"); return; }
  const conditions = [scope(req, supplierOrdersTable)];
  if (parsed.data.orderStatus) conditions.push(eq(supplierOrdersTable.orderStatus, parsed.data.orderStatus));
  if (parsed.data.businessCustomerId != null) conditions.push(eq(supplierOrdersTable.businessCustomerId, parsed.data.businessCustomerId));
  if (parsed.data.projectId != null) conditions.push(eq(supplierOrdersTable.projectId, parsed.data.projectId));
  const rows = await db.select({
    order: supplierOrdersTable,
    customerName: businessCustomersTable.companyName,
  }).from(supplierOrdersTable)
    .innerJoin(businessCustomersTable, eq(supplierOrdersTable.businessCustomerId, businessCustomersTable.id))
    .where(and(...conditions, eq(businessCustomersTable.tenantId, req.tenantId!), eq(businessCustomersTable.environmentId, req.environmentId!)))
    .orderBy(desc(supplierOrdersTable.updatedAt));
  res.json(rows.map(({ order, customerName }) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    businessCustomerId: order.businessCustomerId,
    customerName,
    projectId: order.projectId,
    bidId: order.bidId,
    estimateId: order.estimateId,
    proposalId: order.proposalId,
    sourceQuoteId: order.sourceQuoteId,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    orderDate: order.orderDate,
    promisedDate: order.promisedDate,
    subtotal: asNumber(order.subtotal),
    totalCost: asNumber(order.totalCost),
    totalSell: asNumber(order.totalSell),
    grossMargin: asNumber(order.grossMargin),
    jobsiteInstructions: order.jobsiteInstructions,
    customerVisibleStatus: order.customerVisibleStatus,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  })));
});

router.get("/supplier-orders/:orderId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = GetSupplierOrderParams.safeParse(req.params);
  if (!params.success) { badRequest(res, "Invalid supplier order"); return; }
  const detail = await serializeOrderDetail(req, params.data.orderId);
  if (!detail) { notFound(res, "Supplier order not found"); return; }
  res.json(detail);
});

router.patch("/supplier-orders/:orderId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = UpdateSupplierOrderParams.safeParse(req.params);
  const parsed = UpdateSupplierOrderBody.safeParse(req.body);
  if (!path.success || !parsed.success) { badRequest(res, "Invalid supplier order update"); return; }
  const existing = await getOrder(req, path.data.orderId);
  if (!existing) { notFound(res, "Supplier order not found"); return; }
  if (parsed.data.orderStatus === "closed") {
    const terms = await getSupplierTerms(req, existing.order.businessCustomerId);
    const invoices = await db.select().from(supplierInvoicesTable).where(and(
      eq(supplierInvoicesTable.orderId, path.data.orderId),
      scope(req, supplierInvoicesTable),
    ));
    const blocked = invoices.find((invoice) => {
      const payable = Math.max(asNumber(invoice.totalAmount) - asNumber(invoice.retainageAmount) - asNumber(invoice.paidAmount), 0);
      return payable > 0 && buildPaymentGate(invoice, terms).status === "blocked";
    });
    if (blocked) {
      res.status(409).json({ error: "Supplier order cannot close until retainage and waiver requirements are satisfied" });
      return;
    }
  }
  const [updated] = await db.update(supplierOrdersTable).set({
    ...(parsed.data.orderStatus === undefined ? {} : {
      orderStatus: parsed.data.orderStatus,
      customerVisibleStatus: parsed.data.orderStatus,
    }),
    ...(parsed.data.paymentStatus === undefined ? {} : { paymentStatus: parsed.data.paymentStatus }),
    ...(parsed.data.promisedDate === undefined ? {} : { promisedDate: dateOnly(parsed.data.promisedDate) }),
    ...(parsed.data.jobsiteInstructions === undefined ? {} : { jobsiteInstructions: parsed.data.jobsiteInstructions?.trim() ?? null }),
    updatedAt: new Date(),
  }).where(and(eq(supplierOrdersTable.id, path.data.orderId), scope(req, supplierOrdersTable))).returning();
  if (parsed.data.orderStatus && parsed.data.orderStatus !== existing.order.orderStatus) {
    await audit(req, path.data.orderId, "order", path.data.orderId, "status_changed", existing.order.orderStatus, parsed.data.orderStatus);
  }
  const detail = await serializeOrderDetail(req, updated.id);
  res.json(detail);
});

router.post("/supplier-orders/:orderId/deliveries", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = CreateSupplierDeliveryParams.safeParse(req.params);
  const parsed = CreateSupplierDeliveryBody.safeParse(req.body);
  if (!path.success || !parsed.success) { badRequest(res, "Invalid supplier delivery"); return; }
  const order = await getOrder(req, path.data.orderId);
  if (!order) { notFound(res, "Supplier order not found"); return; }
  const orderLines = await db.select().from(supplierOrderLinesTable).where(and(
    eq(supplierOrderLinesTable.orderId, path.data.orderId),
    scope(req, supplierOrderLinesTable),
  ));
  const lineMap = new Map(orderLines.map((line) => [line.id, line]));
  for (const line of parsed.data.lines) {
    const orderLine = lineMap.get(line.orderLineId);
    const exceptionQuantity = (line.quantityDamaged ?? 0) + (line.quantityShort ?? 0) + (line.quantityReturned ?? 0);
    if (!orderLine
      || line.quantityDelivered + asNumber(orderLine.deliveredQuantity) > asNumber(orderLine.quantity)
      || exceptionQuantity > line.quantityDelivered) {
      badRequest(res, "Delivery quantity exceeds the open order quantity"); return;
    }
  }
  const delivery = await db.transaction(async (tx) => {
    const deliveryNumber = `DEL-${order.order.orderNumber}-${Date.now()}`;
    const status = parsed.data.status ?? "scheduled";
    const [created] = await tx.insert(supplierDeliveriesTable).values({
      orderId: path.data.orderId,
      deliveryNumber,
      status,
      appointmentDate: dateOnly(parsed.data.appointmentDate) ?? null,
      carrier: parsed.data.carrier?.trim() ?? null,
      trackingReference: parsed.data.trackingReference?.trim() ?? null,
      jobsiteInstructions: parsed.data.jobsiteInstructions?.trim() ?? order.order.jobsiteInstructions,
      notes: parsed.data.notes?.trim() ?? null,
      deliveredAt: ["delivered", "partial"].includes(status) ? new Date() : null,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    }).returning();
    await tx.insert(supplierDeliveryLinesTable).values(parsed.data.lines.map((line) => ({
      deliveryId: created.id,
      orderLineId: line.orderLineId,
      quantityDelivered: String(line.quantityDelivered),
      quantityReceived: "0",
      quantityDamaged: String(line.quantityDamaged ?? 0),
      quantityShort: String(line.quantityShort ?? 0),
      quantityReturned: String(line.quantityReturned ?? 0),
      exceptionNote: line.exceptionNote?.trim() ?? null,
      acceptedByUserId: null,
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
    })));
    for (const line of parsed.data.lines) {
      const existingLine = lineMap.get(line.orderLineId)!;
      const delivered = asNumber(existingLine.deliveredQuantity) + line.quantityDelivered;
      const purchased = Math.max(asNumber(existingLine.purchasedQuantity), delivered);
      await tx.update(supplierOrderLinesTable).set({
        purchasedQuantity: String(purchased),
        deliveredQuantity: String(delivered),
        backorderedQuantity: String(Math.max(0, asNumber(existingLine.quantity) - purchased)),
        updatedAt: new Date(),
      }).where(and(eq(supplierOrderLinesTable.id, line.orderLineId), scope(req, supplierOrderLinesTable)));
    }
    return created;
  });
  await audit(req, path.data.orderId, "delivery", delivery.id, "delivery_recorded", null, delivery.status);
  await updateOrderFulfillment(req, path.data.orderId);
  res.status(201).json(serializeDelivery(delivery));
});

router.patch("/supplier-deliveries/:deliveryId", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = UpdateSupplierDeliveryParams.safeParse(req.params);
  const parsed = UpdateSupplierDeliveryBody.safeParse(req.body);
  if (!path.success || !parsed.success) { badRequest(res, "Invalid supplier delivery update"); return; }
  const [existing] = await db.select().from(supplierDeliveriesTable).where(and(
    eq(supplierDeliveriesTable.id, path.data.deliveryId),
    scope(req, supplierDeliveriesTable),
  ));
  if (!existing) { notFound(res, "Supplier delivery not found"); return; }
  const [row] = await db.update(supplierDeliveriesTable).set({
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    ...(parsed.data.recipientName === undefined ? {} : { recipientName: parsed.data.recipientName }),
    ...(parsed.data.notes === undefined ? {} : { notes: parsed.data.notes }),
    ...(parsed.data.status && ["delivered", "partial"].includes(parsed.data.status) ? { deliveredAt: existing.deliveredAt ?? new Date() } : {}),
    updatedAt: new Date(),
  }).where(and(eq(supplierDeliveriesTable.id, path.data.deliveryId), scope(req, supplierDeliveriesTable))).returning();
  await audit(req, existing.orderId, "delivery", row.id, "delivery_updated", existing.status, row.status);
  res.json(serializeDelivery(row));
});

router.post("/supplier-deliveries/:deliveryId/proof-upload", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  if (rejectDeliveryProofUploadRate(req, res)) return;
  const path = RequestSupplierDeliveryProofUploadParams.safeParse(req.params);
  const parsed = RequestSupplierDeliveryProofUploadBody.safeParse(req.body);
  if (!path.success || !parsed.success || !allowedDeliveryProofContentTypes.has(parsed.data.contentType)) {
    badRequest(res, "Invalid proof-of-delivery file name, size, or content type");
    return;
  }
  const [delivery] = await db.select().from(supplierDeliveriesTable).where(and(
    eq(supplierDeliveriesTable.id, path.data.deliveryId),
    scope(req, supplierDeliveriesTable),
  ));
  if (!delivery) { notFound(res, "Supplier delivery not found"); return; }
  if (delivery.proofObjectPath) {
    try {
      await objectStorage.assertExists(delivery.proofObjectPath);
      res.status(409).json({ error: "This delivery already has proof of delivery attached" });
      return;
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }
  }
  let objectPath: string | undefined;
  try {
    const upload = await objectStorage.requestUpload("supplier-delivery-proof");
    objectPath = upload.objectPath;
    const [reserved] = await db.update(supplierDeliveriesTable).set({
      proofObjectPath: objectPath,
      proofFileName: sanitizeFileName(parsed.data.originalName),
      proofContentType: parsed.data.contentType,
      proofFileSize: parsed.data.size,
      updatedAt: new Date(),
    }).where(and(
      eq(supplierDeliveriesTable.id, delivery.id),
      scope(req, supplierDeliveriesTable),
    )).returning();
    await audit(req, delivery.orderId, "delivery", delivery.id, "proof_upload_reserved", delivery.status, delivery.status, reserved.proofFileName ?? undefined);
    res.status(201).json({
      uploadURL: upload.uploadURL,
      objectPath: upload.objectPath,
      proofFileName: reserved.proofFileName!,
    });
  } catch (error) {
    if (objectPath) await objectStorage.deleteObject(objectPath).catch((cleanupError) => req.log.warn({ err: cleanupError }, "Unable to clean up proof upload reservation"));
    req.log.error({ err: error, deliveryId: delivery.id }, "Failed to create proof-of-delivery upload");
    res.status(503).json({ error: "Proof-of-delivery storage is temporarily unavailable" });
  }
});

router.post("/supplier-deliveries/:deliveryId/proof-upload/complete", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  if (rejectDeliveryProofUploadRate(req, res)) return;
  const path = CompleteSupplierDeliveryProofUploadParams.safeParse(req.params);
  if (!path.success) { badRequest(res, "Invalid supplier delivery"); return; }
  const [delivery] = await db.select().from(supplierDeliveriesTable).where(and(
    eq(supplierDeliveriesTable.id, path.data.deliveryId),
    scope(req, supplierDeliveriesTable),
  ));
  if (!delivery) { notFound(res, "Supplier delivery not found"); return; }
  if (!delivery.proofObjectPath || !delivery.proofFileName || !delivery.proofContentType || !delivery.proofFileSize) {
    res.status(409).json({ error: "Proof-of-delivery upload metadata is incomplete" });
    return;
  }
  try {
    const metadata = await objectStorage.getMetadata(delivery.proofObjectPath);
    const storedSize = Number(metadata.size ?? 0);
    const storedContentType = typeof metadata.contentType === "string" ? metadata.contentType : null;
    if (storedSize <= 0 || storedSize > delivery.proofFileSize || storedSize > maxDeliveryProofSize) {
      await objectStorage.deleteObject(delivery.proofObjectPath).catch(() => undefined);
      await db.update(supplierDeliveriesTable).set({
        proofObjectPath: null,
        proofFileName: null,
        proofContentType: null,
        proofFileSize: null,
        updatedAt: new Date(),
      }).where(and(eq(supplierDeliveriesTable.id, delivery.id), scope(req, supplierDeliveriesTable)));
      res.status(413).json({ error: "Uploaded proof exceeds the declared size" });
      return;
    }
    if (storedContentType && storedContentType !== delivery.proofContentType) {
      await objectStorage.deleteObject(delivery.proofObjectPath).catch(() => undefined);
      await db.update(supplierDeliveriesTable).set({
        proofObjectPath: null,
        proofFileName: null,
        proofContentType: null,
        proofFileSize: null,
        updatedAt: new Date(),
      }).where(and(eq(supplierDeliveriesTable.id, delivery.id), scope(req, supplierDeliveriesTable)));
      res.status(415).json({ error: "Uploaded proof content type does not match its declared type" });
      return;
    }
    const screening = await screenStoredDocument(objectStorage.getStoredObject(delivery.proofObjectPath), delivery.proofContentType, storedSize);
    if (screening.status === "rejected") {
      await objectStorage.deleteObject(delivery.proofObjectPath).catch(() => undefined);
      await db.update(supplierDeliveriesTable).set({
        proofObjectPath: null,
        proofFileName: null,
        proofContentType: null,
        proofFileSize: null,
        updatedAt: new Date(),
      }).where(and(eq(supplierDeliveriesTable.id, delivery.id), scope(req, supplierDeliveriesTable)));
      res.status(screening.reason === "content_mismatch" ? 415 : 422).json({ error: "Proof-of-delivery file failed upload safety screening" });
      return;
    }
    const [updated] = await db.update(supplierDeliveriesTable).set({
      proofFileSize: storedSize,
      updatedAt: new Date(),
    }).where(and(eq(supplierDeliveriesTable.id, delivery.id), scope(req, supplierDeliveriesTable))).returning();
    await audit(req, delivery.orderId, "delivery", delivery.id, "proof_uploaded", delivery.status, delivery.status, updated.proofFileName ?? undefined);
    res.json(serializeDelivery(updated));
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(409).json({ error: "Proof upload has not completed yet" });
      return;
    }
    req.log.error({ err: error, deliveryId: delivery.id }, "Failed to complete proof-of-delivery upload");
    res.status(503).json({ error: "Proof-of-delivery storage is temporarily unavailable" });
  }
});

router.get("/supplier-deliveries/:deliveryId/proof", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = CompleteSupplierDeliveryProofUploadParams.safeParse(req.params);
  if (!path.success) { badRequest(res, "Invalid supplier delivery"); return; }
  const [delivery] = await db.select().from(supplierDeliveriesTable).where(and(
    eq(supplierDeliveriesTable.id, path.data.deliveryId),
    scope(req, supplierDeliveriesTable),
  ));
  if (!delivery?.proofObjectPath || !delivery.proofFileName || !delivery.proofContentType) {
    res.status(404).json({ error: "Proof of delivery not found" });
    return;
  }
  try {
    const metadata = await objectStorage.getMetadata(delivery.proofObjectPath);
    res.setHeader("Content-Type", metadata.contentType || delivery.proofContentType);
    res.setHeader("Content-Length", String(metadata.size ?? delivery.proofFileSize ?? 0));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFileName(delivery.proofFileName)}"`);
    const stream = await objectStorage.openReadStream(delivery.proofObjectPath);
    stream.on("error", (error) => {
      req.log.error({ err: error, deliveryId: delivery.id }, "Failed to stream proof of delivery");
      if (!res.headersSent) res.status(500).json({ error: "Failed to read proof of delivery" });
    });
    stream.pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Stored proof of delivery not found" });
      return;
    }
    req.log.error({ err: error, deliveryId: delivery.id }, "Failed to open proof of delivery");
    res.status(503).json({ error: "Proof-of-delivery storage is temporarily unavailable" });
  }
});

router.post("/supplier-deliveries/:deliveryId/receiving", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = RecordSupplierReceivingParams.safeParse(req.params);
  const parsed = RecordSupplierReceivingBody.safeParse(req.body);
  if (!path.success || !parsed.success) { badRequest(res, "Invalid receiving record"); return; }
  const [delivery] = await db.select().from(supplierDeliveriesTable).where(and(
    eq(supplierDeliveriesTable.id, path.data.deliveryId),
    scope(req, supplierDeliveriesTable),
  ));
  if (!delivery) { notFound(res, "Supplier delivery not found"); return; }
  if (delivery.status === "canceled") { badRequest(res, "Canceled deliveries cannot be received"); return; }
  for (const line of parsed.data.lines) {
    const [deliveryLine] = await db.select().from(supplierDeliveryLinesTable).where(and(
      eq(supplierDeliveryLinesTable.id, line.deliveryLineId),
      eq(supplierDeliveryLinesTable.deliveryId, delivery.id),
      scope(req, supplierDeliveryLinesTable),
    ));
    const quantityReceived = line.accepted === false ? 0 : line.quantityReceived;
    const accountedQuantity = quantityReceived + (line.quantityDamaged ?? 0) + (line.quantityShort ?? 0) + (line.quantityReturned ?? 0);
    if (!deliveryLine || accountedQuantity > asNumber(deliveryLine.quantityDelivered)) {
      badRequest(res, "Received quantity exceeds the delivered quantity"); return;
    }
  }
  let nextDeliveryStatus = delivery.status;
  await db.transaction(async (tx) => {
    const touchedOrderLineIds = new Set<number>();
    for (const line of parsed.data.lines) {
      const [deliveryLine] = await tx.select().from(supplierDeliveryLinesTable).where(and(
        eq(supplierDeliveryLinesTable.id, line.deliveryLineId),
        eq(supplierDeliveryLinesTable.deliveryId, delivery.id),
        scope(req, supplierDeliveryLinesTable),
      ));
      if (!deliveryLine) continue;
      const quantityReceived = line.accepted === false ? 0 : line.quantityReceived;
      touchedOrderLineIds.add(deliveryLine.orderLineId);
      await tx.update(supplierDeliveryLinesTable).set({
        acceptedByUserId: line.accepted === false ? null : req.localUserId ?? null,
        quantityReceived: String(quantityReceived),
        quantityDamaged: String(line.quantityDamaged ?? 0),
        quantityShort: String(line.quantityShort ?? 0),
        quantityReturned: String(line.quantityReturned ?? 0),
        exceptionNote: line.exceptionNote?.trim() ?? deliveryLine.exceptionNote,
      }).where(and(eq(supplierDeliveryLinesTable.id, deliveryLine.id), scope(req, supplierDeliveryLinesTable)));
    }
    for (const orderLineId of touchedOrderLineIds) {
      const [orderLine] = await tx.select().from(supplierOrderLinesTable).where(and(
        eq(supplierOrderLinesTable.id, orderLineId),
        scope(req, supplierOrderLinesTable),
      ));
      if (!orderLine) continue;
      const deliveryLines = await tx.select({ quantityReceived: supplierDeliveryLinesTable.quantityReceived })
        .from(supplierDeliveryLinesTable)
        .where(and(
          eq(supplierDeliveryLinesTable.orderLineId, orderLineId),
          scope(req, supplierDeliveryLinesTable),
        ));
      const receivedQuantity = deliveryLines.reduce((sum, item) => sum + asNumber(item.quantityReceived), 0);
      await tx.update(supplierOrderLinesTable).set({
        receivedQuantity: String(Math.min(asNumber(orderLine.quantity), receivedQuantity)),
        updatedAt: new Date(),
      }).where(and(eq(supplierOrderLinesTable.id, orderLine.id), scope(req, supplierOrderLinesTable)));
    }
    const deliveryLines = await tx.select().from(supplierDeliveryLinesTable).where(and(
      eq(supplierDeliveryLinesTable.deliveryId, delivery.id),
      scope(req, supplierDeliveryLinesTable),
    ));
    const allAccounted = deliveryLines.length > 0 && deliveryLines.every((line) =>
      asNumber(line.quantityReceived) + asNumber(line.quantityDamaged) + asNumber(line.quantityShort) + asNumber(line.quantityReturned)
        >= asNumber(line.quantityDelivered),
    );
    const hasException = deliveryLines.some((line) => asNumber(line.quantityDamaged) > 0 || asNumber(line.quantityShort) > 0 || asNumber(line.quantityReturned) > 0);
    const allReturned = deliveryLines.length > 0 && deliveryLines.every((line) =>
      asNumber(line.quantityReturned) >= asNumber(line.quantityDelivered),
    );
    nextDeliveryStatus = allReturned ? "returned" : hasException ? "exception" : allAccounted ? "delivered" : "partial";
    if (nextDeliveryStatus !== delivery.status) {
      await tx.update(supplierDeliveriesTable).set({
        status: nextDeliveryStatus,
        deliveredAt: ["delivered", "partial", "exception", "returned"].includes(nextDeliveryStatus) ? delivery.deliveredAt ?? new Date() : delivery.deliveredAt,
        updatedAt: new Date(),
      }).where(and(eq(supplierDeliveriesTable.id, delivery.id), scope(req, supplierDeliveriesTable)));
    }
  });
  if (nextDeliveryStatus !== delivery.status) {
    await audit(req, delivery.orderId, "delivery", delivery.id, "delivery_status_changed", delivery.status, nextDeliveryStatus);
  }
  await audit(req, delivery.orderId, "delivery", delivery.id, "receiving_recorded", null, nextDeliveryStatus, parsed.data.lines.some((line) => (line.quantityDamaged ?? 0) > 0 || (line.quantityShort ?? 0) > 0 || (line.quantityReturned ?? 0) > 0 || line.accepted === false) ? "Receiving exceptions recorded" : "Receiving accepted");
  await updateOrderFulfillment(req, delivery.orderId);
  const detail = await serializeOrderDetail(req, delivery.orderId);
  res.json(detail);
});

router.post("/supplier-orders/:orderId/invoices", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const path = CreateSupplierInvoiceParams.safeParse(req.params);
  const parsed = CreateSupplierInvoiceBody.safeParse(req.body);
  if (!path.success || !parsed.success) { badRequest(res, "Invalid supplier invoice"); return; }
  const order = await getOrder(req, path.data.orderId);
  if (!order) { notFound(res, "Supplier order not found"); return; }
  const terms = await getSupplierTerms(req, order.order.businessCustomerId);
  const totalAmount = parsed.data.totalAmount;
  const retainageAmount = parsed.data.retainageAmount ?? money(totalAmount * asNumber(terms?.retainageRequired) / 100);
  const payableAmount = Math.max(totalAmount - retainageAmount, 0);
  const paidAmount = parsed.data.paidAmount ?? (parsed.data.status === "paid" ? payableAmount : 0);
  const waiverStatus = parsed.data.waiverStatus ?? (terms?.waiverRequired ? "pending" : "not_required");
  if (paidAmount > payableAmount) {
    badRequest(res, "Paid amount cannot exceed the invoice total after retainage");
    return;
  }
  if (paidAmount > 0 && terms?.waiverRequired && !["received", "approved"].includes(waiverStatus)) {
    res.status(409).json({ error: "Payment is blocked until the supplier waiver is received or approved" });
    return;
  }
  if (parsed.data.status === "paid" && paidAmount < payableAmount) {
    badRequest(res, "A paid invoice must include the amount paid after retainage");
    return;
  }
  const status = parsed.data.status ?? (paidAmount >= payableAmount && payableAmount > 0 ? "paid" : paidAmount > 0 ? "partially_paid" : "submitted");
  const [row] = await db.insert(supplierInvoicesTable).values({
    orderId: path.data.orderId,
    invoiceNumber: parsed.data.invoiceNumber.trim(),
    invoiceDate: dateOnly(parsed.data.invoiceDate) ?? null,
    dueDate: dateOnly(parsed.data.dueDate) ?? null,
    subtotal: String(parsed.data.subtotal ?? parsed.data.totalAmount),
    retainageAmount: String(retainageAmount),
    totalAmount: String(totalAmount),
    paidAmount: String(paidAmount),
    status,
    paymentReference: parsed.data.paymentReference?.trim() ?? null,
    waiverStatus,
    waiverReference: parsed.data.waiverReference?.trim() ?? null,
    paidAt: status === "paid" ? new Date() : null,
    objectPath: parsed.data.objectPath ?? null,
    notes: parsed.data.notes?.trim() ?? null,
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
  }).returning();
  const paymentStatus = status === "paid" ? "paid" : paidAmount > 0 ? "partially_paid" : "invoiced";
  await db.update(supplierOrdersTable).set({ paymentStatus, updatedAt: new Date() }).where(and(
    eq(supplierOrdersTable.id, path.data.orderId),
    scope(req, supplierOrdersTable),
  ));
  await audit(req, path.data.orderId, "invoice", row.id, "invoice_recorded", null, status);
  if (paidAmount > 0) {
    await audit(req, path.data.orderId, "invoice", row.id, "payment_recorded", null, status, parsed.data.paymentReference?.trim() || "Payment recorded");
  }
  await updateLinkedCommitmentTotals(req, path.data.orderId);
  res.status(201).json(serializeInvoice(row));
});

router.get("/supplier-orders/:orderId/events", requireRole("owner", "admin", "member"), async (req: TenantRequest, res) => {
  const params = GetSupplierOrderParams.safeParse(req.params);
  if (!params.success) { badRequest(res, "Invalid supplier order"); return; }
  const order = await getOrder(req, params.data.orderId);
  if (!order) { notFound(res, "Supplier order not found"); return; }
  const rows = await db.select().from(supplierOrderEventsTable).where(and(
    eq(supplierOrderEventsTable.orderId, params.data.orderId),
    scope(req, supplierOrderEventsTable),
  )).orderBy(desc(supplierOrderEventsTable.createdAt));
  res.json(rows.map(serializeEvent));
});

export default router;