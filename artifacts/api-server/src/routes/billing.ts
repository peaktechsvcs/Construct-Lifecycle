import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  subscriptionAuditEventsTable,
  tenantBillingAccountsTable,
  tenantEntitlementOverridesTable,
} from "@workspace/db";
import { requireTenantContext, type TenantRequest } from "../middlewares/tenantContext";
import { requirePlatformAdmin } from "../middlewares/platformAdmin";
import { requireRole } from "../middlewares/rbac";
import { getUncachableStripeClient } from "../stripeClient";

const router: IRouter = Router();
const stripePriceId = z.string().min(5).max(100);
const capabilityKey = z.string().regex(/^[a-z][a-z0-9_.-]{1,80}$/);

router.use("/billing", requireTenantContext);

type Row = Record<string, unknown>;
const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function readPlans() {
  try {
    const result = await db.execute(sql`
      select
        p.id as "productId",
        p.name,
        p.description,
        p.active,
        p.metadata,
        coalesce(json_agg(json_build_object(
          'id', pr.id,
          'active', pr.active,
          'currency', pr.currency,
          'unitAmount', pr.unit_amount,
          'type', pr.type,
          'recurring', pr.recurring,
          'nickname', pr.nickname
        ) order by pr.unit_amount nulls last) filter (where pr.id is not null), '[]'::json) as prices
      from stripe.products p
      left join stripe.prices pr on pr.product = p.id
      group by p.id
      order by p.active desc, p.name asc
    `);
    const syncedPlans = result.rows.map((row) => {
      const metadata = jsonObject(row.metadata);
      return {
        productId: String(row.productId),
        name: String(row.name ?? "Untitled plan"),
        description: row.description ? String(row.description) : null,
        active: Boolean(row.active),
        entitlements: metadata.entitlements ? JSON.parse(String(metadata.entitlements)) : {},
        limits: metadata.limits ? JSON.parse(String(metadata.limits)) : {},
        prices: row.prices ?? [],
      };
    });
    if (syncedPlans.length > 0) return syncedPlans;
  } catch {
    console.warn("[stripe] synced plans unavailable; using connector proxy", { operation: "readPlans" });
  }

  const stripe = getUncachableStripeClient();
  const [products, prices] = await Promise.all([
    stripe.products.list({ active: "true", limit: "100" }),
    stripe.prices.list({ active: "true", type: "recurring", limit: "100" }),
  ]);
  return products.data.map((product) => {
    const metadata = jsonObject(product.metadata);
    return {
      productId: product.id,
      name: String(product.name ?? "Untitled plan"),
      description: product.description ? String(product.description) : null,
      active: Boolean(product.active),
      entitlements: metadata.entitlements ? JSON.parse(String(metadata.entitlements)) : {},
      limits: metadata.limits ? JSON.parse(String(metadata.limits)) : {},
      prices: prices.data.filter((price) => String(price.product) === product.id).map((price) => ({
        id: price.id,
        active: Boolean(price.active),
        currency: String(price.currency ?? "usd"),
        unitAmount: typeof price.unit_amount === "number" ? price.unit_amount : null,
        type: String(price.type ?? "recurring"),
        recurring: price.recurring ?? null,
        nickname: price.nickname ? String(price.nickname) : null,
      })),
    };
  });
}

async function ensureBillingAccount(req: TenantRequest) {
  const [existing] = await db.select().from(tenantBillingAccountsTable)
    .where(eq(tenantBillingAccountsTable.tenantId, req.tenantId!)).limit(1);
  if (existing) return existing;

  const stripe = await getUncachableStripeClient();
  const customer = await stripe.customers.create({
    metadata: { tenantId: String(req.tenantId) },
  });
  const [created] = await db.insert(tenantBillingAccountsTable).values({
    tenantId: req.tenantId!,
    externalCustomerId: customer.id,
  }).returning();
  return created;
}

async function readBillingAccount(tenantId: number) {
  const [account] = await db.select().from(tenantBillingAccountsTable)
    .where(eq(tenantBillingAccountsTable.tenantId, tenantId)).limit(1);
  if (!account) return null;

  let row: Row | undefined;
  let directSubscription: unknown = row?.subscription ?? null;
  let directPaymentMethod: unknown = row?.paymentMethod ?? null;
  try {
    const result = await db.execute(sql`
      select
        c.id as "customerId",
        c.email,
        c.name,
        c.delinquent,
        (
          select json_build_object(
            'id', s.id,
            'status', s.status,
            'priceId', (s.items->'data'->0->'price'->>'id'),
            'currentPeriodEnd', s.current_period_end,
            'currentPeriodStart', s.current_period_start,
            'cancelAtPeriodEnd', s.cancel_at_period_end,
            'trialEnd', s.trial_end
          )
          from stripe.subscriptions s
          where s.customer = c.id
            and s.status not in ('canceled', 'incomplete_expired')
          order by s.created desc
          limit 1
        ) as subscription,
        (
          select json_build_object('brand', pm.card->>'brand', 'last4', pm.card->>'last4', 'expMonth', pm.card->>'exp_month', 'expYear', pm.card->>'exp_year')
          from stripe.payment_methods pm
          where pm.customer = c.id and pm.type = 'card'
          order by pm.created desc
          limit 1
        ) as "paymentMethod"
      from stripe.customers c
      where c.id = ${account.externalCustomerId}
      limit 1
    `);
    row = result.rows[0] as Row | undefined;
    directSubscription = row?.subscription ?? null;
    directPaymentMethod = row?.paymentMethod ?? null;
  } catch {
    console.warn("[stripe] synced billing account unavailable; using connector proxy", { operation: "readBillingAccount" });
  }
  if (!row) {
    const stripe = getUncachableStripeClient();
    const [customer, subscriptions, paymentMethods] = await Promise.all([
      stripe.customers.retrieve(account.externalCustomerId),
      stripe.subscriptions.list({ customer: account.externalCustomerId, status: "all", limit: "10" }),
      stripe.paymentMethods.list({ customer: account.externalCustomerId, type: "card", limit: "10" }),
    ]);
    const active = subscriptions.data.find((subscription) => !["canceled", "incomplete_expired"].includes(String(subscription.status)));
    const card = paymentMethods.data[0];
    row = customer;
    directSubscription = active ? {
      id: active.id,
      status: active.status,
      priceId: (active.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data?.[0]?.price?.id ?? null,
      cancelAtPeriodEnd: Boolean(active.cancel_at_period_end),
    } : null;
    directPaymentMethod = card ? {
      brand: (card.card as Record<string, unknown> | undefined)?.brand,
      last4: (card.card as Record<string, unknown> | undefined)?.last4,
    } : null;
  }
  const overrides = await db.select({
    capabilityKey: tenantEntitlementOverridesTable.capabilityKey,
    enabled: tenantEntitlementOverridesTable.enabled,
  }).from(tenantEntitlementOverridesTable)
    .where(eq(tenantEntitlementOverridesTable.tenantId, tenantId));

  return {
    provider: account.provider,
    customerId: account.externalCustomerId,
    email: row?.email ?? account.billingContactEmail,
    name: row?.name ?? null,
    delinquent: Boolean(row?.delinquent),
    subscription: directSubscription,
    paymentMethod: directPaymentMethod,
    overrides,
  };
}

async function audit(req: TenantRequest, action: string, details: Record<string, unknown>, providerReference?: string) {
  await db.insert(subscriptionAuditEventsTable).values({
    tenantId: req.tenantId!,
    actorUserId: req.localUserId ?? null,
    action,
    providerReference,
    details: JSON.stringify(details),
  });
}

router.get("/billing/plans", async (_req, res) => {
  try {
    res.json(await readPlans());
  } catch (error) {
    _req.log.error({ err: error }, "Failed to read billing plans");
    res.status(503).json({ error: "Billing plans are temporarily unavailable" });
  }
});

router.get("/billing", async (req: TenantRequest, res) => {
  res.json({ plans: await readPlans(), billing: await readBillingAccount(req.tenantId!) });
});

router.post("/billing/checkout", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const parsed = z.object({
    priceId: stripePriceId,
    successUrl: z.string().url(),
    cancelUrl: z.string().url(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid checkout request", details: parsed.error.issues });
    return;
  }
  try {
    const account = await ensureBillingAccount(req);
    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: account.externalCustomerId,
      line_items: [{ price: parsed.data.priceId, quantity: 1 }],
      success_url: parsed.data.successUrl,
      cancel_url: parsed.data.cancelUrl,
      client_reference_id: String(req.tenantId),
      subscription_data: { metadata: { tenantId: String(req.tenantId) } },
    });
    await audit(req, "checkout_started", { priceId: parsed.data.priceId }, session.id);
    res.json({ url: session.url });
  } catch (error) {
    req.log.error({ err: error }, "Failed to create billing checkout");
    res.status(502).json({ error: "Unable to start checkout" });
  }
});

router.post("/billing/portal", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const parsed = z.object({ returnUrl: z.string().url() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid portal request" });
    return;
  }
  try {
    const account = await ensureBillingAccount(req);
    const stripe = await getUncachableStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: account.externalCustomerId,
      return_url: parsed.data.returnUrl,
    });
    await audit(req, "billing_portal_opened", {}, session.id);
    res.json({ url: session.url });
  } catch (error) {
    req.log.error({ err: error }, "Failed to create billing portal");
    res.status(502).json({ error: "Unable to open billing portal" });
  }
});

router.post("/billing/cancel", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  try {
    const account = await ensureBillingAccount(req);
    const stripe = await getUncachableStripeClient();
    const subscriptions = await stripe.subscriptions.list({ customer: account.externalCustomerId, status: "all", limit: 10 });
    const active = subscriptions.data.find((subscription) => ["trialing", "active", "past_due", "unpaid"].includes(String(subscription.status)));
    if (!active) {
      res.status(409).json({ error: "No active subscription found" });
      return;
    }
    const updated = await stripe.subscriptions.update(active.id, { cancel_at_period_end: true });
    await audit(req, "subscription_cancel_at_period_end", { subscriptionId: updated.id }, updated.id);
    res.json({ status: updated.status, cancelAtPeriodEnd: updated.cancel_at_period_end });
  } catch (error) {
    req.log.error({ err: error }, "Failed to schedule subscription cancellation");
    res.status(502).json({ error: "Unable to update subscription" });
  }
});

router.post("/billing/reactivate", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  try {
    const account = await ensureBillingAccount(req);
    const stripe = await getUncachableStripeClient();
    const subscriptions = await stripe.subscriptions.list({ customer: account.externalCustomerId, status: "all", limit: 10 });
    const active = subscriptions.data.find((subscription) => subscription.cancel_at_period_end);
    if (!active) {
      res.status(409).json({ error: "No scheduled cancellation found" });
      return;
    }
    const updated = await stripe.subscriptions.update(active.id, { cancel_at_period_end: false });
    await audit(req, "subscription_reactivated", { subscriptionId: updated.id }, updated.id);
    res.json({ status: updated.status, cancelAtPeriodEnd: updated.cancel_at_period_end });
  } catch (error) {
    req.log.error({ err: error }, "Failed to reactivate subscription");
    res.status(502).json({ error: "Unable to reactivate subscription" });
  }
});

router.get("/billing/invoices", async (req: TenantRequest, res) => {
  const account = await db.select({ customerId: tenantBillingAccountsTable.externalCustomerId })
    .from(tenantBillingAccountsTable)
    .where(eq(tenantBillingAccountsTable.tenantId, req.tenantId!)).limit(1);
  if (!account[0]) {
    res.json([]);
    return;
  }
  try {
    const result = await db.execute(sql`
      select id, number, status, currency, amount_due as "amountDue", amount_paid as "amountPaid",
        hosted_invoice_url as "hostedInvoiceUrl", invoice_pdf as "invoicePdf", created
      from stripe.invoices
      where customer = ${account[0].customerId}
      order by created desc
      limit 50
    `);
    if (result.rows.length > 0) {
      res.json(result.rows);
      return;
    }
  } catch {
    console.warn("[stripe] synced invoices unavailable; using connector proxy", { operation: "readInvoices" });
  }
  const stripe = getUncachableStripeClient();
  const invoices = await stripe.invoices.list({ customer: account[0].customerId, limit: "50" });
  res.json(invoices.data.map((invoice) => ({
    id: invoice.id,
    number: invoice.number ?? null,
    status: invoice.status ?? null,
    currency: invoice.currency ?? null,
    amountDue: invoice.amount_due ?? null,
    amountPaid: invoice.amount_paid ?? null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdf: invoice.invoice_pdf ?? null,
    created: invoice.created ?? null,
  })));
});

router.get("/billing/audit", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const events = await db.select().from(subscriptionAuditEventsTable)
    .where(eq(subscriptionAuditEventsTable.tenantId, req.tenantId!))
    .orderBy(desc(subscriptionAuditEventsTable.createdAt)).limit(50);
  res.json(events);
});

router.get("/platform/billing/plans", requirePlatformAdmin, async (_req, res) => {
  res.json(await readPlans());
});

router.post("/platform/billing/plans", requirePlatformAdmin, async (req: TenantRequest, res) => {
  const parsed = z.object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).optional(),
    monthlyAmount: z.number().int().min(0),
    annualAmount: z.number().int().min(0),
    entitlements: z.record(z.string(), z.unknown()).default({}),
    limits: z.record(z.string(), z.unknown()).default({}),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid plan", details: parsed.error.issues });
    return;
  }
  try {
    const stripe = await getUncachableStripeClient();
    const product = await stripe.products.create({
      name: parsed.data.name,
      description: parsed.data.description,
      metadata: {
        entitlements: JSON.stringify(parsed.data.entitlements),
        limits: JSON.stringify(parsed.data.limits),
      },
    });
    const prices = await Promise.all([
      stripe.prices.create({ product: product.id, currency: "usd", unit_amount: parsed.data.monthlyAmount, recurring: { interval: "month" }, nickname: `${parsed.data.name} monthly` }),
      stripe.prices.create({ product: product.id, currency: "usd", unit_amount: parsed.data.annualAmount, recurring: { interval: "year" }, nickname: `${parsed.data.name} annual` }),
    ]);
    res.status(201).json({ productId: product.id, priceIds: prices.map((price) => price.id) });
  } catch (error) {
    req.log.error({ err: error }, "Failed to create billing plan");
    res.status(502).json({ error: "Unable to create billing plan" });
  }
});

router.patch("/platform/billing/entitlements/:tenantId", requirePlatformAdmin, async (req: TenantRequest, res) => {
  const tenantId = Number(req.params.tenantId);
  const parsed = z.object({ capabilityKey, enabled: z.boolean() }).safeParse(req.body);
  if (!Number.isInteger(tenantId) || !parsed.success) {
    res.status(400).json({ error: "Invalid entitlement override" });
    return;
  }
  const [override] = await db.insert(tenantEntitlementOverridesTable).values({
    tenantId,
    capabilityKey: parsed.data.capabilityKey,
    enabled: parsed.data.enabled,
    updatedByUserId: req.localUserId!,
  }).onConflictDoUpdate({
    target: [tenantEntitlementOverridesTable.tenantId, tenantEntitlementOverridesTable.capabilityKey],
    set: { enabled: parsed.data.enabled, updatedByUserId: req.localUserId!, updatedAt: new Date() },
  }).returning();
  await audit({ ...req, tenantId } as TenantRequest, "entitlement_override_changed", parsed.data);
  res.json(override);
});

export default router;