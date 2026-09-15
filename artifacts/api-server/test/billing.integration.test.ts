import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";

process.env.APP_ENV = "test";
process.env.REPLIT_CONNECTORS_HOSTNAME = "mock-connectors.test";
process.env.REPL_IDENTITY = "billing-test-identity";

const {
  db,
  environmentsTable,
  membershipsTable,
  pool,
  platformFeatureFlagsTable,
  stripeWebhookEventsTable,
  subscriptionAuditEventsTable,
  tenantBillingAccountsTable,
  tenantEntitlementOverridesTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} = await import("@workspace/db");
const { default: app } = await import("../src/app.ts");
const { WebhookHandlers } = await import("../src/webhookHandlers.ts");
const {
  resolveEffectiveEntitlements,
  subscriptionAccessState,
} = await import("../src/lib/feature-catalog.ts");

type Json = Record<string, unknown> | unknown[];
type StripeCustomer = {
  id: string;
  email: string;
  name: string;
  delinquent: boolean;
};
type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  items: { data: Array<{ price: { id: string } }> };
};

const runId = `${Date.now()}-${process.pid}`;
const clerkIds = {
  ownerA: `billing-owner-a-${runId}`,
  ownerB: `billing-owner-b-${runId}`,
  platformAdmin: `billing-platform-admin-${runId}`,
};

const customers = new Map<string, StripeCustomer>();
const subscriptions = new Map<string, StripeSubscription>();
const invoices = new Map<string, Array<Record<string, unknown>>>();
const connectorCalls: Array<{ method: string; path: string; body: string }> = [];
let nextProduct = 1;
let nextPrice = 1;
let nextSession = 1;
let nextCustomer = 1;
let nextSubscription = 1;
let server: Server;
let baseUrl = "";
let tenantAId: number;
let tenantBId: number;
let customerAId: string;
let customerBId: string;
let environmentAId: number;
let environmentBId: number;
let originalBillingFlag: typeof platformFeatureFlagsTable.$inferSelect | undefined;

const nativeFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function decodeBody(init?: RequestInit) {
  return new URLSearchParams(typeof init?.body === "string" ? init.body : "");
}

function stripePath(url: URL) {
  const proxyPrefix = "/api/v2/proxy";
  return url.pathname.startsWith(proxyPrefix)
    ? url.pathname.slice(proxyPrefix.length)
    : url.pathname;
}

function stripeObjectFromParams(params: URLSearchParams) {
  return Object.fromEntries(params.entries());
}

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname !== "mock-connectors.test") {
    return nativeFetch(input, init);
  }

  if (url.pathname === "/api/v2/connection") {
    return jsonResponse({
      items: [{ settings: { webhook_secret: undefined } }],
    });
  }

  const path = stripePath(url);
  const method = init?.method ?? "GET";
  const body = decodeBody(init);
  connectorCalls.push({ method, path, body: body.toString() });

  if (method === "GET" && path === "/v1/products") {
    return jsonResponse({
      data: [
        {
          id: "prod-standard",
          name: "Standard",
          description: "Standard workspace",
          active: true,
           metadata: { entitlements: JSON.stringify({ projects: true, billing: true }) },
        },
      ],
    });
  }
  if (method === "GET" && path === "/v1/prices") {
    return jsonResponse({
      data: [
        {
          id: "price-monthly",
          product: "prod-standard",
          active: true,
          currency: "usd",
          unit_amount: 4900,
          type: "recurring",
          recurring: { interval: "month" },
          nickname: "Standard monthly",
        },
        {
          id: "price-annual",
          product: "prod-standard",
          active: true,
          currency: "usd",
          unit_amount: 49000,
          type: "recurring",
          recurring: { interval: "year" },
          nickname: "Standard annual",
        },
      ],
    });
  }
  if (method === "POST" && path === "/v1/customers") {
    const id = `cus-created-${nextCustomer++}`;
    const customer = { id, email: "", name: "", delinquent: false };
    customers.set(id, customer);
    return jsonResponse(customer);
  }
  if (method === "GET" && path.startsWith("/v1/customers/")) {
    const customer = customers.get(path.split("/").pop()!);
    return customer ? jsonResponse(customer) : jsonResponse({ error: "not found" }, 404);
  }
  if (method === "GET" && path === "/v1/subscriptions") {
    const customerId = url.searchParams.get("customer");
    return jsonResponse({
      data: [...subscriptions.values()].filter((subscription) => subscription.customer === customerId),
    });
  }
  if (method === "POST" && path.startsWith("/v1/subscriptions/")) {
    const id = path.split("/").pop()!;
    const subscription = subscriptions.get(id);
    if (!subscription) return jsonResponse({ error: "not found" }, 404);
    const cancelAtPeriodEnd = body.get("cancel_at_period_end");
    if (cancelAtPeriodEnd !== null) subscription.cancel_at_period_end = cancelAtPeriodEnd === "true";
    return jsonResponse(subscription);
  }
  if (method === "GET" && path === "/v1/payment_methods") {
    return jsonResponse({ data: [] });
  }
  if (method === "GET" && path === "/v1/invoices") {
    return jsonResponse({ data: invoices.get(url.searchParams.get("customer") ?? "") ?? [] });
  }
  if (method === "POST" && path === "/v1/checkout/sessions") {
    const sessionId = `cs-test-${nextSession++}`;
    return jsonResponse({
      id: sessionId,
      url: `https://checkout.stripe.test/${sessionId}`,
    });
  }
  if (method === "POST" && path === "/v1/billing_portal/sessions") {
    return jsonResponse({ id: "bps-test", url: "https://billing.stripe.test/session" });
  }
  if (method === "POST" && path === "/v1/products") {
    return jsonResponse({
      id: `prod-created-${nextProduct++}`,
      name: body.get("name"),
      active: true,
      metadata: {},
    });
  }
  if (method === "POST" && path === "/v1/prices") {
    return jsonResponse({
      id: `price-created-${nextPrice++}`,
      product: body.get("product"),
      active: true,
      currency: body.get("currency"),
      unit_amount: Number(body.get("unit_amount")),
      type: "recurring",
      recurring: { interval: body.get("recurring[interval]") },
    });
  }

  return jsonResponse({ error: `unhandled mock request: ${method} ${path}` }, 500);
};

async function request(clerkUserId: string, path: string, init: RequestInit = {}) {
  const response = await nativeFetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-clerk-user-id": clerkUserId,
      ...init.headers,
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Json : undefined,
  };
}

function subscriptionFor(customer: string, status = "active", priceId = "price-monthly") {
  const subscription = {
    id: `sub-test-${nextSubscription++}`,
    customer,
    status,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: priceId } }] },
  };
  subscriptions.set(subscription.id, subscription);
  return subscription;
}

before(async () => {
  const [tenantA, tenantB] = await db.insert(tenantsTable).values([
    { name: "Billing Tenant A", slug: `billing-a-${runId}` },
    { name: "Billing Tenant B", slug: `billing-b-${runId}` },
  ]).returning();
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  const [environmentA, environmentB] = await db.insert(environmentsTable).values([
    { tenantId: tenantAId, name: "Test", slug: "test", kind: "dtd" },
    { tenantId: tenantBId, name: "Test", slug: "test", kind: "dtd" },
  ]).returning();
  environmentAId = environmentA.id;
  environmentBId = environmentB.id;

  const users = await db.insert(usersTable).values([
    { clerkUserId: clerkIds.ownerA, email: `${clerkIds.ownerA}@integration.test`, displayName: "Owner A" },
    { clerkUserId: clerkIds.ownerB, email: `${clerkIds.ownerB}@integration.test`, displayName: "Owner B" },
    { clerkUserId: clerkIds.platformAdmin, email: `${clerkIds.platformAdmin}@integration.test`, displayName: "Platform Admin", isPlatformAdmin: true },
  ]).returning();
  const userId = Object.fromEntries(users.map((user) => [user.clerkUserId, user.id]));

  await db.insert(membershipsTable).values([
    { tenantId: tenantAId, userId: userId[clerkIds.ownerA], role: "owner" },
    { tenantId: tenantBId, userId: userId[clerkIds.ownerB], role: "owner" },
  ]);
  await db.insert(userTenantContextTable).values([
    { userId: userId[clerkIds.ownerA], activeTenantId: tenantAId, activeEnvironmentId: environmentAId },
    { userId: userId[clerkIds.ownerB], activeTenantId: tenantBId, activeEnvironmentId: environmentBId },
  ]);

  customerAId = "cus-billing-a";
  customerBId = "cus-billing-b";
  customers.set(customerAId, { id: customerAId, email: "a@billing.test", name: "Billing A", delinquent: false });
  customers.set(customerBId, { id: customerBId, email: "b@billing.test", name: "Billing B", delinquent: true });
  await db.insert(tenantBillingAccountsTable).values([
    { tenantId: tenantAId, externalCustomerId: customerAId },
    { tenantId: tenantBId, externalCustomerId: customerBId },
  ]);
  const subscriptionA = subscriptionFor(customerAId);
  subscriptionFor(customerBId, "unpaid", "price-annual");
  invoices.set(customerAId, [{ id: "in-a", number: "A-001", status: "paid", amount_paid: 4900 }]);
  invoices.set(customerBId, [{ id: "in-b", number: "B-001", status: "open", amount_due: 49000 }]);
  await db.insert(tenantEntitlementOverridesTable).values({
    tenantId: tenantAId,
    capabilityKey: "projects",
    enabled: true,
    updatedByUserId: userId[clerkIds.ownerA],
  });
  [originalBillingFlag] = await db.select().from(platformFeatureFlagsTable)
    .where(eq(platformFeatureFlagsTable.key, "billing")).limit(1);
  await db.delete(platformFeatureFlagsTable).where(eq(platformFeatureFlagsTable.key, "billing"));
  await db.insert(platformFeatureFlagsTable).values({
    key: "billing",
    enabled: true,
    updatedByUserId: userId[clerkIds.platformAdmin],
  });

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  assert.equal(subscriptionA.customer, customerAId);
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (tenantAId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantAId));
  if (tenantBId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantBId));
  await db.delete(platformFeatureFlagsTable).where(eq(platformFeatureFlagsTable.key, "billing"));
  if (originalBillingFlag) await db.insert(platformFeatureFlagsTable).values(originalBillingFlag);
  globalThis.fetch = nativeFetch;
  await pool.end();
});

describe("billing tenant boundaries", () => {
  test("reads only the active tenant account, invoices, and entitlement overrides", async () => {
    const account = await request(clerkIds.ownerA, "/billing");
    assert.equal(account.status, 200);
    assert.equal((account.body as Record<string, unknown>).billing && ((account.body as Record<string, unknown>).billing as Record<string, unknown>).customerId, customerAId);
    assert.doesNotMatch(JSON.stringify(account.body), /cus-billing-b|B-001|Billing B/);

    const invoiceResult = await request(clerkIds.ownerA, "/billing/invoices");
    assert.equal(invoiceResult.status, 200);
    assert.match(JSON.stringify(invoiceResult.body), /A-001/);
    assert.doesNotMatch(JSON.stringify(invoiceResult.body), /B-001/);

    const foreignOverride = await request(clerkIds.ownerA, `/platform/billing/entitlements/${tenantBId}`, {
      method: "PATCH",
      body: JSON.stringify({ capabilityKey: "projects", enabled: false }),
    });
    assert.equal(foreignOverride.status, 403);

    const tenantBOverrides = await db.select().from(tenantEntitlementOverridesTable)
      .where(eq(tenantEntitlementOverridesTable.tenantId, tenantBId));
    assert.equal(tenantBOverrides.length, 0);
  });

  test("checkout and billing mutations stay bound to the caller tenant", async () => {
    const checkout = await request(clerkIds.ownerA, "/billing/checkout", {
      method: "POST",
      body: JSON.stringify({
        priceId: "price-monthly",
        successUrl: "https://app.test/success",
        cancelUrl: "https://app.test/cancel",
      }),
    });
    assert.equal(checkout.status, 200);
    const checkoutCall = connectorCalls.find((call) => call.path === "/v1/checkout/sessions");
    assert.equal(checkoutCall?.method, "POST");
    assert.match(checkoutCall?.body ?? "", /customer=cus-billing-a/);
    assert.doesNotMatch(checkoutCall?.body ?? "", /cus-billing-b/);

    const foreignCheckout = await request(clerkIds.ownerB, "/billing/checkout", {
      method: "POST",
      body: JSON.stringify({
        priceId: "price-annual",
        successUrl: "https://app.test/success",
        cancelUrl: "https://app.test/cancel",
      }),
    });
    assert.equal(foreignCheckout.status, 200);
    const checkoutCalls = connectorCalls.filter((call) => call.path === "/v1/checkout/sessions");
    assert.match(checkoutCalls.at(-1)?.body ?? "", /customer=cus-billing-b/);
  });
});

describe("effective subscription access policy", () => {
  test("documents access for every supported Stripe subscription state", () => {
    assert.equal(subscriptionAccessState("active"), "active");
    assert.equal(subscriptionAccessState("trialing"), "active");
    assert.equal(subscriptionAccessState("past_due"), "grace_period");
    assert.equal(subscriptionAccessState("unpaid"), "suspended");
    assert.equal(subscriptionAccessState("canceled"), "suspended");
    assert.equal(subscriptionAccessState("active", true), "scheduled_cancellation");
    assert.equal(subscriptionAccessState("trialing", true), "scheduled_cancellation");
    assert.equal(subscriptionAccessState(null), "not_subscribed");
  });

  test("keeps plan access in grace and at scheduled cancellation, but not after suspension", () => {
    const input = {
      planEntitlements: { contracts: true, billing: true },
      overrides: [],
    };
    assert.deepEqual(resolveEffectiveEntitlements({ ...input, status: "active" }).entitlements, {
      contracts: true,
      billing: true,
    });
    assert.deepEqual(resolveEffectiveEntitlements({ ...input, status: "past_due" }).entitlements, {
      contracts: true,
      billing: true,
    });
    assert.deepEqual(resolveEffectiveEntitlements({ ...input, status: "active", cancelAtPeriodEnd: true }).entitlements, {
      contracts: true,
      billing: true,
    });
    assert.deepEqual(resolveEffectiveEntitlements({ ...input, status: "unpaid" }).entitlements, {
      contracts: false,
      billing: false,
    });
    assert.deepEqual(resolveEffectiveEntitlements({ ...input, status: "canceled" }).entitlements, {
      contracts: false,
      billing: false,
    });
  });

  test("applies tenant-scoped overrides after subscription policy", () => {
    const resolved = resolveEffectiveEntitlements({
      status: "unpaid",
      planEntitlements: { contracts: true },
      overrides: [
        { capabilityKey: "contracts", enabled: true },
        { capabilityKey: "reports", enabled: false },
      ],
    });
    assert.deepEqual(resolved.entitlements, {
      contracts: true,
      reports: false,
    });
  });
});

describe("billing lifecycle", () => {
  test("returns monthly and annual prices and creates both plan frequencies", async () => {
    const plans = await request(clerkIds.ownerA, "/billing/plans");
    assert.equal(plans.status, 200);
    const serializedPlans = JSON.stringify(plans.body);
    assert.match(serializedPlans, /price-monthly/);
    assert.match(serializedPlans, /price-annual/);

    const created = await request(clerkIds.platformAdmin, "/platform/billing/plans", {
      method: "POST",
      body: JSON.stringify({
        name: "Growth",
        monthlyAmount: 7900,
        annualAmount: 79000,
        entitlements: { projects: true },
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(((created.body as Record<string, unknown>).priceIds as string[]).length, 2);
    const priceCalls = connectorCalls.filter((call) => call.path === "/v1/prices");
    assert.match(priceCalls.at(-2)?.body ?? "", /recurring%5Binterval%5D=month/);
    assert.match(priceCalls.at(-1)?.body ?? "", /recurring%5Binterval%5D=year/);
  });

  test("cancels at period end and reactivates without changing tenant data", async () => {
    const cancel = await request(clerkIds.ownerA, "/billing/cancel", { method: "POST" });
    assert.equal(cancel.status, 200);
    assert.deepEqual(cancel.body, { status: "active", cancelAtPeriodEnd: true });

    const reactivation = await request(clerkIds.ownerA, "/billing/reactivate", { method: "POST" });
    assert.equal(reactivation.status, 200);
    assert.deepEqual(reactivation.body, { status: "active", cancelAtPeriodEnd: false });

    const account = await request(clerkIds.ownerA, "/billing");
    assert.equal(account.status, 200);
    assert.equal(((account.body as Record<string, unknown>).billing as Record<string, unknown>).customerId, customerAId);
  });

  test("preserves failed-payment state and resolves overrides for the correct tenant", async () => {
    const accountB = await request(clerkIds.ownerB, "/billing");
    assert.equal(accountB.status, 200);
    const billing = (accountB.body as Record<string, unknown>).billing as Record<string, unknown>;
    assert.equal(billing.delinquent, true);
    assert.equal((billing.subscription as Record<string, unknown>).status, "unpaid");
    assert.deepEqual(billing.overrides, []);

    const adminOverride = await request(clerkIds.platformAdmin, `/platform/billing/entitlements/${tenantBId}`, {
      method: "PATCH",
      body: JSON.stringify({ capabilityKey: "projects", enabled: false }),
    });
    assert.equal(adminOverride.status, 200);
    const updated = await request(clerkIds.ownerB, "/billing");
    assert.deepEqual(((updated.body as Record<string, unknown>).billing as Record<string, unknown>).overrides, [
      { capabilityKey: "projects", enabled: false },
    ]);

    const accountA = await request(clerkIds.ownerA, "/billing");
    assert.deepEqual(((accountA.body as Record<string, unknown>).billing as Record<string, unknown>).overrides, [
      { capabilityKey: "projects", enabled: true },
    ]);

    const tenantAFeatures = await request(clerkIds.ownerA, "/features");
    assert.equal(tenantAFeatures.status, 200);
    assert.equal(
      (tenantAFeatures.body as Array<Record<string, unknown>>).some((feature) => feature.key === "billing"),
      true,
    );

    const tenantBFeatures = await request(clerkIds.ownerB, "/features");
    assert.equal(tenantBFeatures.status, 200);
    assert.equal(
      (tenantBFeatures.body as Array<Record<string, unknown>>).some((feature) => feature.key === "billing"),
      false,
    );
  });
});

describe("Stripe webhook boundary", () => {
  test("requires a raw payload and a signature", async () => {
    await assert.rejects(
      WebhookHandlers.processWebhook("not raw bytes" as unknown as Buffer, "sig_test"),
      /raw Buffer/,
    );

    const missingSignature = await request(clerkIds.ownerA, "/stripe/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "invoice.paid" }),
    });
    assert.equal(missingSignature.status, 400);
    assert.deepEqual(missingSignature.body, { error: "Missing Stripe signature" });
  });

  test("fails closed when the connected runtime does not expose a signing secret", async () => {
    const response = await nativeFetch(`${baseUrl}/api/stripe/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=1,v1=test",
      },
      body: Buffer.from(JSON.stringify({ type: "invoice.paid" })),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Webhook processing failed" });
  });

  test("processes a verified event once across duplicate, concurrent, and replayed deliveries", async () => {
    await db.delete(stripeWebhookEventsTable)
      .where(eq(stripeWebhookEventsTable.eventId, "evt_duplicatesubscription"));
    await db.delete(subscriptionAuditEventsTable)
      .where(eq(subscriptionAuditEventsTable.providerReference, "sub-test-1"));
    const event = Buffer.from(JSON.stringify({
      id: "evt_duplicatesubscription",
      type: "customer.subscription.updated",
      data: { object: { id: "sub-test-1" } },
    }));
    let processorCalls = 0;
    let verificationCalls = 0;
    let activeProcessors = 0;
    let peakProcessors = 0;
    const sync = {
      verifyWebhook: async (_payload: Buffer, signature: string) => {
        assert.equal(signature, "verified-signature");
        verificationCalls += 1;
        return {} as never;
      },
      processWebhook: async () => {
        processorCalls += 1;
        activeProcessors += 1;
        peakProcessors = Math.max(peakProcessors, activeProcessors);
        await new Promise((resolve) => setTimeout(resolve, 50));
        await db.insert(subscriptionAuditEventsTable).values({
          tenantId: tenantAId,
          action: "stripe_webhook_subscription_updated",
          providerReference: "sub-test-1",
          details: JSON.stringify({ eventId: "evt_duplicatesubscription" }),
        });
        activeProcessors -= 1;
      },
    };

    await Promise.all([
      WebhookHandlers.processWebhook(event, "verified-signature", sync),
      WebhookHandlers.processWebhook(event, "verified-signature", sync),
    ]);
    await WebhookHandlers.processWebhook(event, "verified-signature", {
      verifyWebhook: async (_payload: Buffer, signature: string) => {
        assert.equal(signature, "verified-signature");
        verificationCalls += 1;
        return {} as never;
      },
      processWebhook: async () => {
        processorCalls += 1;
      },
    });

    assert.equal(processorCalls, 1);
    assert.equal(verificationCalls, 3);
    assert.equal(peakProcessors, 1);
    const [receipt] = await db.select().from(stripeWebhookEventsTable)
      .where(eq(stripeWebhookEventsTable.eventId, "evt_duplicatesubscription"));
    assert.equal(receipt?.eventType, "customer.subscription.updated");
    assert.equal(receipt?.processedAt instanceof Date, true);
    const audit = await db.select().from(subscriptionAuditEventsTable)
      .where(eq(subscriptionAuditEventsTable.providerReference, "sub-test-1"));
    assert.equal(audit.length, 1);
    await db.delete(stripeWebhookEventsTable)
      .where(eq(stripeWebhookEventsTable.eventId, "evt_duplicatesubscription"));
  });
});