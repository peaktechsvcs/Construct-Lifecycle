import { eq, sql } from "drizzle-orm";
import {
  db,
  tenantBillingAccountsTable,
  tenantEntitlementOverridesTable,
} from "@workspace/db";
import { getUncachableStripeClient } from "../stripeClient";
import {
  resolveEffectiveEntitlements,
  type EffectiveEntitlementOverride,
  type SubscriptionAccessState,
} from "./feature-catalog";

type Row = Record<string, unknown>;

export type BillingPlan = {
  productId: string;
  name: string;
  description: string | null;
  active: boolean;
  entitlements: Record<string, unknown>;
  limits: Record<string, unknown>;
  prices: Array<Record<string, unknown>>;
};

export type BillingSubscription = {
  id: string;
  status: string;
  priceId: string | null;
  currentPeriodEnd?: unknown;
  currentPeriodStart?: unknown;
  cancelAtPeriodEnd: boolean;
  trialEnd?: unknown;
};

export type BillingAccount = {
  provider: string;
  customerId: string;
  email: unknown;
  name: unknown;
  delinquent: boolean;
  subscription: BillingSubscription | null;
  paymentMethod: unknown;
  overrides: EffectiveEntitlementOverride[];
};

export type EffectiveFeatureAccess = {
  /**
   * Tenants without a billing account remain in legacy/platform-controlled
   * feature mode. Once billing is configured, subscription state is required.
   */
  billingConfigured: boolean;
  state: SubscriptionAccessState;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  planId: string | null;
  planName: string | null;
  entitlements: Record<string, boolean>;
};

const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const parseMetadataRecord = (value: unknown) => {
  if (typeof value !== "string") return {};
  try {
    return jsonObject(JSON.parse(value));
  } catch {
    return {};
  }
};

export async function readPlans(): Promise<BillingPlan[]> {
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
        entitlements: parseMetadataRecord(metadata.entitlements),
        limits: parseMetadataRecord(metadata.limits),
        prices: Array.isArray(row.prices) ? row.prices as Array<Record<string, unknown>> : [],
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
      entitlements: parseMetadataRecord(metadata.entitlements),
      limits: parseMetadataRecord(metadata.limits),
      prices: prices.data
        .filter((price) => String(price.product) === product.id)
        .map((price) => ({
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

export async function readBillingAccount(tenantId: number): Promise<BillingAccount | null> {
  const [account] = await db.select().from(tenantBillingAccountsTable)
    .where(eq(tenantBillingAccountsTable.tenantId, tenantId)).limit(1);
  if (!account) return null;

  let row: Row | undefined;
  let directSubscription: unknown = null;
  let directPaymentMethod: unknown = null;
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
          order by
            case when s.status in ('active', 'trialing', 'past_due', 'unpaid') then 0 else 1 end,
            s.created desc
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
    const current = subscriptions.data.find((subscription) => String(subscription.status) !== "incomplete_expired");
    const card = paymentMethods.data[0];
    row = customer;
    directSubscription = current ? {
      id: current.id,
      status: String(current.status ?? "unknown"),
      priceId: ((current.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data?.[0]?.price?.id as string | undefined) ?? null,
      cancelAtPeriodEnd: Boolean(current.cancel_at_period_end),
      currentPeriodEnd: current.current_period_end,
      currentPeriodStart: current.current_period_start,
      trialEnd: current.trial_end,
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

  const subscriptionRecord = jsonObject(directSubscription);
  return {
    provider: account.provider,
    customerId: account.externalCustomerId,
    email: row?.email ?? account.billingContactEmail,
    name: row?.name ?? null,
    delinquent: Boolean(row?.delinquent),
    subscription: subscriptionRecord.id
      ? {
          id: String(subscriptionRecord.id),
          status: String(subscriptionRecord.status ?? "unknown"),
          priceId: subscriptionRecord.priceId ? String(subscriptionRecord.priceId) : null,
          currentPeriodEnd: subscriptionRecord.currentPeriodEnd,
          currentPeriodStart: subscriptionRecord.currentPeriodStart,
          cancelAtPeriodEnd: Boolean(subscriptionRecord.cancelAtPeriodEnd),
          trialEnd: subscriptionRecord.trialEnd,
        }
      : null,
    paymentMethod: directPaymentMethod,
    overrides,
  };
}

export async function getEffectiveFeatureAccess(tenantId: number): Promise<EffectiveFeatureAccess> {
  let account: BillingAccount | null;
  try {
    account = await readBillingAccount(tenantId);
  } catch {
    // A subscription that cannot be verified must not unlock paid features.
    return {
      billingConfigured: true,
      state: "suspended",
      subscriptionStatus: null,
      cancelAtPeriodEnd: false,
      planId: null,
      planName: null,
      entitlements: {},
    };
  }
  if (!account?.subscription) {
    const resolved = resolveEffectiveEntitlements({
      status: null,
      cancelAtPeriodEnd: false,
      planEntitlements: {},
      overrides: account?.overrides ?? [],
    });
    return {
      billingConfigured: Boolean(account),
      ...resolved,
      subscriptionStatus: null,
      cancelAtPeriodEnd: false,
      planId: null,
      planName: null,
    };
  }

  let plan: BillingPlan | undefined;
  try {
    const plans = await readPlans();
    plan = plans.find((candidate) => candidate.prices.some((price) => price.id === account.subscription?.priceId));
  } catch {
    // A missing provider response must fail closed for feature access.
  }
  const resolved = resolveEffectiveEntitlements({
    status: account.subscription.status,
    cancelAtPeriodEnd: account.subscription.cancelAtPeriodEnd,
    planEntitlements: plan?.entitlements ?? {},
    overrides: account.overrides,
  });
  return {
    billingConfigured: true,
    ...resolved,
    subscriptionStatus: account.subscription.status,
    cancelAtPeriodEnd: account.subscription.cancelAtPeriodEnd,
    planId: plan?.productId ?? null,
    planName: plan?.name ?? null,
  };
}