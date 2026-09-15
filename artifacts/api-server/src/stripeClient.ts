import { ReplitConnectors } from "@replit/connectors-sdk";
import { StripeSync } from "stripe-replit-sync";
import type { Stripe } from "stripe";

const connectors = new ReplitConnectors();

type StripeApiResponse = {
  id: string;
  [key: string]: unknown;
};

type StripeFacade = {
  customers: {
    create(input: Record<string, unknown>): Promise<StripeApiResponse>;
    retrieve(id: string): Promise<StripeApiResponse>;
  };
  checkout: {
    sessions: {
      create(input: Record<string, unknown>): Promise<StripeApiResponse>;
    };
  };
  billingPortal: {
    sessions: {
      create(input: Record<string, unknown>): Promise<StripeApiResponse>;
    };
  };
  subscriptions: {
    list(input: Record<string, unknown>): Promise<{ data: StripeApiResponse[] }>;
    update(id: string, input: Record<string, unknown>): Promise<StripeApiResponse>;
  };
  products: {
    create(input: Record<string, unknown>): Promise<StripeApiResponse>;
    list(input: Record<string, unknown>): Promise<{ data: StripeApiResponse[] }>;
  };
  prices: {
    create(input: Record<string, unknown>): Promise<StripeApiResponse>;
    list(input: Record<string, unknown>): Promise<{ data: StripeApiResponse[] }>;
  };
  invoices: {
    list(input: Record<string, unknown>): Promise<{ data: StripeApiResponse[] }>;
  };
  paymentMethods: {
    list(input: Record<string, unknown>): Promise<{ data: StripeApiResponse[] }>;
  };
};

function formEncode(value: unknown, prefix?: string, output: URLSearchParams = new URLSearchParams()) {
  if (value === undefined || value === null) return output;
  if (Array.isArray(value)) {
    value.forEach((item, index) => formEncode(item, `${prefix}[${index}]`, output));
    return output;
  }
  if (typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      formEncode(item, prefix ? `${prefix}[${key}]` : key, output);
    });
    return output;
  }
  output.set(prefix!, String(value));
  return output;
}

async function request<T>(
  path: string,
  method: "GET" | "POST",
  input?: Record<string, unknown>,
): Promise<T> {
  const url = method === "GET" && input
    ? `${path}?${new URLSearchParams(Object.entries(input).map(([key, value]) => [key, String(value)]))}`
    : path;
  const response = await connectors.proxy("stripe", url, {
    method,
    ...(method === "POST"
      ? { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: formEncode(input).toString() }
      : {}),
  });
  if (!response.ok) {
    throw new Error(`Stripe API request failed with status ${response.status}`);
  }
  return await response.json() as T;
}

export function getUncachableStripeClient(): StripeFacade {
  return {
    customers: {
      create: (input) => request("/v1/customers", "POST", input),
      retrieve: (id) => request(`/v1/customers/${id}`, "GET"),
    },
    checkout: {
      sessions: {
        create: (input) => request("/v1/checkout/sessions", "POST", input),
      },
    },
    billingPortal: {
      sessions: {
        create: (input) => request("/v1/billing_portal/sessions", "POST", input),
      },
    },
    subscriptions: {
      list: async (input) => request<{ data: StripeApiResponse[] }>("/v1/subscriptions", "GET", input),
      update: (id, input) => request(`/v1/subscriptions/${id}`, "POST", input),
    },
    products: {
      create: (input) => request("/v1/products", "POST", input),
      list: async (input) => request<{ data: StripeApiResponse[] }>("/v1/products", "GET", input),
    },
    prices: {
      create: (input) => request("/v1/prices", "POST", input),
      list: async (input) => request<{ data: StripeApiResponse[] }>("/v1/prices", "GET", input),
    },
    invoices: {
      list: async (input) => request<{ data: StripeApiResponse[] }>("/v1/invoices", "GET", input),
    },
    paymentMethods: {
      list: async (input) => request<{ data: StripeApiResponse[] }>("/v1/payment_methods", "GET", input),
    },
  };
}

async function getStripeSyncCredentials(): Promise<{ secretKey: string; webhookSecret?: string }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const identity = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;
  if (!hostname || !identity) throw new Error("Stripe sync credentials are unavailable");

  const response = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    { headers: { Accept: "application/json", X_REPLIT_TOKEN: identity }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(`Stripe sync credentials request failed with status ${response.status}`);
  const data = await response.json() as {
    items?: Array<{ settings?: { secret_key?: string; webhook_secret?: string } }>;
  };
  const settings = data.items?.[0]?.settings;
  if (!settings?.secret_key) throw new Error("Stripe sync secret is not available for this connection");
  return { secretKey: settings.secret_key, webhookSecret: settings.webhook_secret };
}

type StripeWebhookEvent = Stripe.Event;

async function getManagedWebhookSecret(sync: StripeSync): Promise<string | undefined> {
  const accountId = await sync.getAccountId();
  const result = await sync.postgresClient.query(
    `SELECT secret FROM "stripe"."_managed_webhooks" WHERE account_id = $1 LIMIT 1`,
    [accountId],
  );
  const secret = result.rows[0]?.secret;
  return typeof secret === "string" && secret.length > 0 ? secret : undefined;
}

export type VerifiedStripeSync = StripeSync & {
  verifyWebhook(payload: Buffer, signature: string): Promise<StripeWebhookEvent>;
};

export async function getStripeSync(): Promise<VerifiedStripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe sync");
  const { secretKey, webhookSecret } = await getStripeSyncCredentials();
  const sync = new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
    backfillRelatedEntities: true,
  });
  return Object.assign(sync, {
    verifyWebhook: async (payload: Buffer, signature: string) => {
      const secret = webhookSecret ?? await getManagedWebhookSecret(sync);
      if (!secret) {
        throw new Error(
          "No webhook secret provided. Either create a managed webhook or configure stripeWebhookSecret.",
        );
      }
      return await sync.stripe.webhooks.constructEventAsync(payload, signature, secret);
    },
  });
}