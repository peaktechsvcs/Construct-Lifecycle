import type { ReplitConnectors } from "@replit/connectors-sdk";
import type {
  AccountingCostStatusInput,
  AccountingPayApplicationInput,
  AccountingProvider,
  AccountingProviderContext,
} from "./provider";

const connectorName = "quickbooks";
const withTimeout = async <T>(promise: Promise<T>, timeoutMs = 30_000): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Accounting provider request timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) throw new Error(`QuickBooks request failed (${response.status})`);
  return response.json() as Promise<T>;
};

const cleanName = (value: string) => value.replace(/[\r\n]/g, " ").trim().slice(0, 500) || "Construct Lifecycle project";
const escapeQueryValue = (value: string) => value.replace(/'/g, "\\'");

type QuickBooksCompanyInfo = {
  companyId?: string;
  realmId?: string;
  QueryResponse?: { CompanyInfo?: Array<{ Id?: string }> };
};

type QuickBooksCustomer = {
  Id?: string;
  DisplayName?: string;
};

const createProvider = (connectors: ReplitConnectors): AccountingProvider => {
  const request = (
    path: string,
    options?: { method?: string; body?: unknown },
  ) => withTimeout(connectors.proxy(connectorName, path, {
    method: options?.method,
    body: options?.body,
    headers: { Accept: "application/json" },
  }));

  const getCompanyId = async (context: AccountingProviderContext) => {
    const configured = context.configuration.companyId;
    if (typeof configured === "string" && /^[A-Za-z0-9_-]+$/.test(configured)) return configured;
    const result = await readJson<QuickBooksCompanyInfo>(await request("/v3/companyinfo"));
    const companyId = result.companyId
      ?? result.realmId
      ?? result.QueryResponse?.CompanyInfo?.find((company) => company.Id)?.Id;
    if (!companyId) throw new Error("QuickBooks company identity is unavailable");
    return companyId;
  };

  const findOrCreateCustomer = async (companyId: string, customerName: string) => {
    const displayName = cleanName(customerName);
    const query = `select Id, DisplayName from Customer where DisplayName = '${escapeQueryValue(displayName)}' maxresults 1`;
    const found = await readJson<{ QueryResponse?: { Customer?: QuickBooksCustomer[] } }>(
      await request(`/v3/company/${encodeURIComponent(companyId)}/query?query=${encodeURIComponent(query)}`),
    );
    const existing = found.QueryResponse?.Customer?.find((customer) => customer.Id);
    if (existing?.Id) return existing.Id;
    const created = await readJson<QuickBooksCustomer>(
      await request(`/v3/company/${encodeURIComponent(companyId)}/customer`, {
        method: "POST",
        body: { DisplayName: displayName },
      }),
    );
    if (!created.Id) throw new Error("QuickBooks did not return a customer id");
    return created.Id;
  };

  return {
    providerKey: connectorName,
    capabilities: new Set(["sync_approved_pay_application", "sync_project_cost_status"]),
    syncApprovedPayApplication: async (context: AccountingProviderContext, input: AccountingPayApplicationInput) => {
      const companyId = await getCompanyId(context);
      const customerId = await findOrCreateCustomer(companyId, input.customerName);
      const invoice = await readJson<{ Id?: string; SyncToken?: string }>(
        await request(`/v3/company/${encodeURIComponent(companyId)}/invoice`, {
          method: "POST",
          body: {
            DocNumber: input.applicationNumber,
            TxnDate: input.approvedAt.toISOString().slice(0, 10),
            CustomerRef: { value: customerId },
            CurrencyRef: { value: input.currencyCode },
            PrivateNote: `Construct Lifecycle project ${input.projectNumber} · ${cleanName(input.projectName)}`,
            Line: [{
              Amount: input.netAmount,
              DetailType: "DescriptionOnly",
              Description: `Approved owner pay application ${input.applicationNumber} (${input.grossAmount.toFixed(2)} gross, ${input.retainageAmount.toFixed(2)} retainage)`,
            }],
          },
        }),
      );
      if (!invoice.Id) throw new Error("QuickBooks did not return an invoice id");
      return {
        externalId: invoice.Id,
        metadata: { resourceType: "invoice", customerId },
      };
    },
    syncProjectCostStatus: async (context: AccountingProviderContext, input: AccountingCostStatusInput) => {
      const companyId = await getCompanyId(context);
      const customerId = await findOrCreateCustomer(companyId, input.customerName);
      const query = `select Id, TotalAmt, TxnDate from Purchase where CustomerRef = '${escapeQueryValue(customerId)}'`;
      const purchases = await readJson<{ QueryResponse?: { Purchase?: Array<{ Id?: string; TotalAmt?: number; TxnDate?: string }> } }>(
        await request(`/v3/company/${encodeURIComponent(companyId)}/query?query=${encodeURIComponent(query)}`),
      );
      const rows = purchases.QueryResponse?.Purchase ?? [];
      const externalCost = rows.reduce((sum, purchase) => sum + Number(purchase.TotalAmt ?? 0), 0);
      return {
        externalId: customerId,
        metadata: {
          resourceType: "project_cost_status",
          purchaseCount: rows.length,
          externalCost,
          localForecastCost: input.forecastCost,
          localActualCost: input.actualCost,
          asOfDate: input.asOfDate,
        },
      };
    },
  };
};

export const registerQuickBooksAccountingProvider = (
  connectors: ReplitConnectors,
  register: (provider: AccountingProvider) => void,
) => {
  register(createProvider(connectors));
};