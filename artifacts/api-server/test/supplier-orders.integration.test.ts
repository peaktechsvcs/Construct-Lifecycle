import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import {
  businessCustomersTable,
  db,
  environmentsTable,
  membershipsTable,
  pool,
  supplierDeliveriesTable,
  supplierDeliveryLinesTable,
  supplierOrderEventsTable,
  supplierOrderLinesTable,
  supplierOrdersTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} from "@workspace/db";
import { ObjectStorageService } from "../src/lib/objectStorage.ts";
import app from "../src/app.ts";

const runId = `${Date.now()}-${process.pid}`;
const clerkUserId = `supplier-orders-${runId}`;
const tenantSlug = `supplier-orders-${runId}`;
const proofFile = Buffer.from("%PDF-1.7\nsupplier delivery proof\n", "utf8");
const objectStorage = new ObjectStorageService();

let server: Server;
let baseUrl = "";
let tenantId: number;
let environmentId: number;
let otherEnvironmentId: number;
let orderId: number;
let orderLineId: number;
let deliveryId: number;
let otherDeliveryId: number;
let uploadedObjectPath: string | undefined;

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-clerk-user-id": clerkUserId,
      ...init.headers,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.arrayBuffer();
  return { response, body };
}

before(async () => {
  const [tenant] = await db.insert(tenantsTable).values({ name: "Supplier Orders", slug: tenantSlug }).returning();
  tenantId = tenant.id;
  const [environment] = await db.insert(environmentsTable).values({
    tenantId,
    name: "Development / Test / Demo",
    slug: "dtd",
    kind: "dtd",
    status: "active",
  }).returning();
  environmentId = environment.id;
  const [otherEnvironment] = await db.insert(environmentsTable).values({
    tenantId,
    name: "Other Environment",
    slug: `other-${runId}`,
    kind: "dtd",
    status: "active",
  }).returning();
  otherEnvironmentId = otherEnvironment.id;
  const [user] = await db.insert(usersTable).values({
    clerkUserId,
    email: `${clerkUserId}@integration.test`,
    displayName: "Supplier Orders Tester",
  }).returning();
  await db.insert(membershipsTable).values({ tenantId, userId: user.id, role: "owner" });
  await db.insert(userTenantContextTable).values({ userId: user.id, activeTenantId: tenantId, activeEnvironmentId: environmentId });
  const [customer] = await db.insert(businessCustomersTable).values({
    tenantId,
    environmentId,
    companyName: "Receiving Test Customer",
    normalizedName: `receiving-test-customer-${runId}`,
  }).returning();
  const [order] = await db.insert(supplierOrdersTable).values({
    tenantId,
    environmentId,
    orderNumber: `PO-RECEIVING-${runId}`,
    businessCustomerId: customer.id,
    orderStatus: "approved",
    paymentStatus: "unbilled",
    totalCost: "100",
    totalSell: "140",
    grossMargin: "40",
  }).returning();
  orderId = order.id;
  const [line] = await db.insert(supplierOrderLinesTable).values({
    tenantId,
    environmentId,
    orderId,
    description: "Receiving test material",
    quantity: "10",
    unit: "each",
    unitCost: "10",
    unitPrice: "14",
    purchasedQuantity: "10",
    backorderedQuantity: "0",
  }).returning();
  orderLineId = line.id;
  const [delivery] = await db.insert(supplierDeliveriesTable).values({
    tenantId,
    environmentId,
    orderId,
    deliveryNumber: `DEL-RECEIVING-${runId}`,
    status: "scheduled",
  }).returning();
  deliveryId = delivery.id;
  await db.insert(supplierDeliveryLinesTable).values({
    tenantId,
    environmentId,
    deliveryId,
    orderLineId,
    quantityDelivered: "6",
  });
  const [otherCustomer] = await db.insert(businessCustomersTable).values({
    tenantId,
    environmentId: otherEnvironmentId,
    companyName: "Other Environment Customer",
    normalizedName: `other-environment-customer-${runId}`,
  }).returning();
  const [otherOrder] = await db.insert(supplierOrdersTable).values({
    tenantId,
    environmentId: otherEnvironmentId,
    orderNumber: `PO-OTHER-${runId}`,
    businessCustomerId: otherCustomer.id,
  }).returning();
  const [otherLine] = await db.insert(supplierOrderLinesTable).values({
    tenantId,
    environmentId: otherEnvironmentId,
    orderId: otherOrder.id,
    description: "Other environment material",
    quantity: "1",
    unit: "each",
  }).returning();
  const [otherDelivery] = await db.insert(supplierDeliveriesTable).values({
    tenantId,
    environmentId: otherEnvironmentId,
    orderId: otherOrder.id,
    deliveryNumber: `DEL-OTHER-${runId}`,
  }).returning();
  otherDeliveryId = otherDelivery.id;
  await db.insert(supplierDeliveryLinesTable).values({
    tenantId,
    environmentId: otherEnvironmentId,
    deliveryId: otherDelivery.id,
    orderLineId: otherLine.id,
    quantityDelivered: "1",
  });

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (uploadedObjectPath) await objectStorage.deleteObject(uploadedObjectPath).catch(() => undefined);
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  await pool.end();
});

test("receiving stores disposition, recomputes totals, and is duplicate-safe", async () => {
  const invalid = await request(`/supplier-deliveries/${deliveryId}/receiving`, {
    method: "POST",
    body: JSON.stringify({
      lines: [{ deliveryLineId: 999999, quantityReceived: 7 }],
    }),
  });
  assert.equal(invalid.response.status, 400);

  const first = await request(`/supplier-deliveries/${deliveryId}/receiving`, {
    method: "POST",
    body: JSON.stringify({
      lines: [{
        deliveryLineId: (await db.select({ id: supplierDeliveryLinesTable.id }).from(supplierDeliveryLinesTable).where(eq(supplierDeliveryLinesTable.deliveryId, deliveryId)))[0].id,
        quantityReceived: 4,
        quantityDamaged: 1,
        quantityShort: 1,
        quantityReturned: 0,
        accepted: true,
        exceptionNote: "One damaged and one short",
      }],
    }),
  });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal((first.body as { deliveries: Array<{ status: string }> }).deliveries[0].status, "exception");

  const repeated = await request(`/supplier-deliveries/${deliveryId}/receiving`, {
    method: "POST",
    body: JSON.stringify({
      lines: [{
        deliveryLineId: (await db.select({ id: supplierDeliveryLinesTable.id }).from(supplierDeliveryLinesTable).where(eq(supplierDeliveryLinesTable.deliveryId, deliveryId)))[0].id,
        quantityReceived: 4,
        quantityDamaged: 1,
        quantityShort: 1,
        quantityReturned: 0,
        accepted: true,
        exceptionNote: "One damaged and one short",
      }],
    }),
  });
  assert.equal(repeated.response.status, 200, JSON.stringify(repeated.body));

  const [line] = await db.select().from(supplierOrderLinesTable).where(eq(supplierOrderLinesTable.id, orderLineId));
  const [deliveryLine] = await db.select().from(supplierDeliveryLinesTable).where(eq(supplierDeliveryLinesTable.deliveryId, deliveryId));
  assert.equal(Number(line.receivedQuantity), 4);
  assert.equal(Number(deliveryLine.quantityReceived), 4);
  assert.equal(Number(deliveryLine.quantityDamaged), 1);
  assert.equal(Number(deliveryLine.quantityShort), 1);
  const events = await db.select().from(supplierOrderEventsTable).where(and(
    eq(supplierOrderEventsTable.orderId, orderId),
    eq(supplierOrderEventsTable.entityId, deliveryId),
  ));
  assert(events.some((event) => event.action === "receiving_recorded"));
  assert(events.some((event) => event.action === "delivery_status_changed"));
});

test("proof uploads are screened, downloadable, and environment-scoped", async () => {
  const pending = await request(`/supplier-deliveries/${deliveryId}/proof-upload`, {
    method: "POST",
    body: JSON.stringify({
      originalName: "delivery-proof.pdf",
      contentType: "application/pdf",
      size: proofFile.length,
    }),
  });
  assert.equal(pending.response.status, 201, JSON.stringify(pending.body));
  const pendingBody = pending.body as { uploadURL: string; objectPath: string };
  uploadedObjectPath = pendingBody.objectPath;
  const upload = await fetch(pendingBody.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: proofFile,
  });
  assert.equal(upload.ok, true);

  const completed = await request(`/supplier-deliveries/${deliveryId}/proof-upload/complete`, { method: "POST" });
  assert.equal(completed.response.status, 200, JSON.stringify(completed.body));
  assert.equal((completed.body as { proofFileName: string }).proofFileName, "delivery-proof.pdf");

  const downloaded = await request(`/supplier-deliveries/${deliveryId}/proof`);
  assert.equal(downloaded.response.status, 200, JSON.stringify(downloaded.body));
  assert.deepEqual(Buffer.from(downloaded.body as ArrayBuffer), proofFile);

  const otherEnvironment = await request(`/supplier-deliveries/${otherDeliveryId}/proof`);
  assert.equal(otherEnvironment.response.status, 404);
});