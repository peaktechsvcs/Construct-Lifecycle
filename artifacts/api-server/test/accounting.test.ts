import assert from "node:assert/strict";
import test from "node:test";
import { getAccountingProviderAvailability, registerAccountingProvider, type AccountingProvider } from "../src/lib/accounting/provider.ts";
import { registerQuickBooksAccountingProvider } from "../src/lib/accounting/quickbooks.ts";

const makeConnector = (options: {
  invoiceFailure?: boolean;
  customerId?: string;
} = {}) => {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const connector = {
    proxy: async (_connectorName: string, path: string, requestOptions?: { method?: string; body?: unknown }) => {
      const method = requestOptions?.method ?? "GET";
      calls.push({ path, method, body: requestOptions?.body });
      if (path === "/v3/companyinfo") {
        return new Response(JSON.stringify({ companyId: "company-1" }), { status: 200 });
      }
      if (path.includes("/query?query=") && decodeURIComponent(path).includes("from Customer")) {
        return new Response(JSON.stringify({
          QueryResponse: { Customer: options.customerId ? [{ Id: options.customerId }] : [] },
        }), { status: 200 });
      }
      if (path.endsWith("/customer") && method === "POST") {
        return new Response(JSON.stringify({ Id: options.customerId ?? "customer-created" }), { status: 200 });
      }
      if (path.endsWith("/invoice") && method === "POST") {
        if (options.invoiceFailure) return new Response("provider unavailable", { status: 503 });
        return new Response(JSON.stringify({ Id: "invoice-1" }), { status: 200 });
      }
      if (path.includes("/query?query=") && decodeURIComponent(path).includes("from Purchase")) {
        return new Response(JSON.stringify({
          QueryResponse: { Purchase: [{ Id: "purchase-1", TotalAmt: 1250, TxnDate: "2026-09-01" }] },
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    },
  };
  return { connector, calls };
};

test("accounting provider availability only includes registered adapters", () => {
  const { connector } = makeConnector();
  registerQuickBooksAccountingProvider(connector as never, registerAccountingProvider);
  const result = getAccountingProviderAvailability(["quickbooks", "missing"]);
  assert.equal(result.available, true);
  assert.deepEqual(result.providers.map((provider) => provider.providerKey), ["quickbooks"]);
});

test("QuickBooks adapter syncs an approved pay application through the managed connector", async () => {
  const { connector, calls } = makeConnector({ customerId: "customer-1" });
  let provider: AccountingProvider | undefined;
  registerQuickBooksAccountingProvider(connector as never, (registered) => { provider = registered; });
  assert(provider);
  const result = await provider.syncApprovedPayApplication({
    tenantId: 10,
    environmentId: 20,
    integrationId: 30,
    configuration: {},
  }, {
    projectId: 40,
    projectNumber: "P-40",
    projectName: "Approved Work",
    customerName: "Owner",
    applicationId: 50,
    applicationNumber: "PA-001",
    approvedAt: new Date("2026-09-14T12:00:00Z"),
    grossAmount: 1000,
    retainageAmount: 100,
    netAmount: 900,
    currencyCode: "USD",
  });
  assert.equal(result.externalId, "invoice-1");
  const invoice = calls.find((call) => call.path.endsWith("/invoice"));
  assert.equal(invoice?.method, "POST");
  assert.equal((invoice?.body as { DocNumber: string }).DocNumber, "PA-001");
  assert.equal((invoice?.body as { CustomerRef: { value: string } }).CustomerRef.value, "customer-1");
});

test("QuickBooks adapter returns provider cost status metadata", async () => {
  const { connector } = makeConnector({ customerId: "customer-1" });
  let provider: AccountingProvider | undefined;
  registerQuickBooksAccountingProvider(connector as never, (registered) => { provider = registered; });
  assert(provider);
  const result = await provider.syncProjectCostStatus({
    tenantId: 10,
    environmentId: 20,
    integrationId: 30,
    configuration: {},
  }, {
    projectId: 40,
    projectNumber: "P-40",
    projectName: "Costed Work",
    customerName: "Owner",
    budgetCost: 5000,
    committedCost: 3200,
    forecastCost: 4500,
    actualCost: 1250,
    forecastRevenue: 7000,
    asOfDate: "2026-09-14",
    currencyCode: "USD",
  });
  assert.equal(result.externalId, "customer-1");
  assert.deepEqual(result.metadata, {
    resourceType: "project_cost_status",
    purchaseCount: 1,
    externalCost: 1250,
    localForecastCost: 4500,
    localActualCost: 1250,
    asOfDate: "2026-09-14",
  });
});

test("QuickBooks adapter surfaces provider failures without exposing response bodies", async () => {
  const { connector } = makeConnector({ invoiceFailure: true, customerId: "customer-1" });
  let provider: AccountingProvider | undefined;
  registerQuickBooksAccountingProvider(connector as never, (registered) => { provider = registered; });
  assert(provider);
  await assert.rejects(
    provider.syncApprovedPayApplication({
      tenantId: 1,
      environmentId: 2,
      integrationId: 3,
      configuration: {},
    }, {
      projectId: 4,
      projectNumber: "P-4",
      projectName: "Failure Case",
      customerName: "Owner",
      applicationId: 5,
      applicationNumber: "PA-FAIL",
      approvedAt: new Date("2026-09-14T12:00:00Z"),
      grossAmount: 100,
      retainageAmount: 0,
      netAmount: 100,
      currencyCode: "USD",
    }),
    /QuickBooks request failed \(503\)/,
  );
});