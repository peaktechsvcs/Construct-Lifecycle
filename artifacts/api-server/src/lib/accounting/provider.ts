export type AccountingProviderCapability =
  | "sync_approved_pay_application"
  | "sync_project_cost_status";

export type AccountingProviderContext = {
  tenantId: number;
  environmentId: number;
  integrationId: number;
  configuration: Record<string, unknown>;
};

export type AccountingPayApplicationInput = {
  projectId: number;
  projectNumber: string;
  projectName: string;
  customerName: string;
  applicationId: number;
  applicationNumber: string;
  approvedAt: Date;
  grossAmount: number;
  retainageAmount: number;
  netAmount: number;
  currencyCode: string;
};

export type AccountingCostStatusInput = {
  projectId: number;
  projectNumber: string;
  projectName: string;
  customerName: string;
  budgetCost: number;
  committedCost: number;
  forecastCost: number;
  actualCost: number;
  forecastRevenue: number;
  asOfDate: string | null;
  currencyCode: string;
};

export type AccountingSyncResult = {
  externalId: string;
  metadata?: Record<string, unknown>;
};

export type AccountingProvider = {
  providerKey: string;
  capabilities: ReadonlySet<AccountingProviderCapability>;
  syncApprovedPayApplication: (
    context: AccountingProviderContext,
    input: AccountingPayApplicationInput,
  ) => Promise<AccountingSyncResult>;
  syncProjectCostStatus: (
    context: AccountingProviderContext,
    input: AccountingCostStatusInput,
  ) => Promise<AccountingSyncResult>;
};

const providers = new Map<string, AccountingProvider>();

export const registerAccountingProvider = (provider: AccountingProvider) => {
  providers.set(provider.providerKey, provider);
};

export const getAccountingProvider = (providerKey: string) => providers.get(providerKey);

export const getAccountingProviderAvailability = (providerKeys: string[]) => {
  const available = providerKeys
    .map((providerKey) => providers.get(providerKey))
    .filter((provider): provider is AccountingProvider => Boolean(provider));
  return {
    available: available.length > 0,
    providers: available,
  };
};