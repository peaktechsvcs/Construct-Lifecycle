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
import { getEffectiveFeatureAccess, readBillingAccount, readPlans } from "../lib/billing-access";

const router: IRouter = Router();
const stripePriceId = z.string().min(5).max(100);
const capabilityKey = z.string().regex(/^[a-z][a-z0-9_.-]{1,80}$/);

router.use("/billing", requireTenantContext);

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

async function audit(
  req: TenantRequest,
  action: string,
  details: Record<string, unknown>,
  providerReference?: string,
  previousState?: Record<string, unknown>,
  newState?: Record<string, unknown>,
) {
  await db.insert(subscriptionAuditEventsTable).values({
    tenantId: req.tenantId!,
    actorUserId: req.localUserId ?? null,
    action,
    providerReference,
    previousState: previousState ? JSON.stringify(previousState) : undefined,
    newState: newState ? JSON.stringify(newState) : undefined,
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
  res.json({
    plans: await readPlans(),
    billing: await readBillingAccount(req.tenantId!),
    effectiveAccess: await getEffectiveFeatureAccess(req.tenantId!),
  });
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
  const [previous] = await db.select({
    capabilityKey: tenantEntitlementOverridesTable.capabilityKey,
    enabled: tenantEntitlementOverridesTable.enabled,
  }).from(tenantEntitlementOverridesTable).where(and(
    eq(tenantEntitlementOverridesTable.tenantId, tenantId),
    eq(tenantEntitlementOverridesTable.capabilityKey, parsed.data.capabilityKey),
  )).limit(1);
  const [override] = await db.insert(tenantEntitlementOverridesTable).values({
    tenantId,
    capabilityKey: parsed.data.capabilityKey,
    enabled: parsed.data.enabled,
    updatedByUserId: req.localUserId!,
  }).onConflictDoUpdate({
    target: [tenantEntitlementOverridesTable.tenantId, tenantEntitlementOverridesTable.capabilityKey],
    set: { enabled: parsed.data.enabled, updatedByUserId: req.localUserId!, updatedAt: new Date() },
  }).returning();
  await audit(
    { ...req, tenantId } as TenantRequest,
    "entitlement_override_changed",
    parsed.data,
    undefined,
    previous ? { capabilityKey: previous.capabilityKey, enabled: previous.enabled } : undefined,
    { capabilityKey: override.capabilityKey, enabled: override.enabled },
  );
  res.json(override);
});

export default router;