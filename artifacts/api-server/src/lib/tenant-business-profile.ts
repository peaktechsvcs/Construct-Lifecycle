import { eq } from "drizzle-orm";
import {
  db,
  platformFeatureFlagsTable,
  tenantBusinessTypesTable,
  TENANT_BUSINESS_TYPES,
  type TenantBusinessType,
} from "@workspace/db";
import { FEATURE_CATALOG, entitledFeatures } from "./feature-catalog";
import { getEffectiveFeatureAccess } from "./billing-access";

export const DEFAULT_TENANT_BUSINESS_TYPES: TenantBusinessType[] = ["general-contractor"];

export function normalizeBusinessTypes(value: unknown): TenantBusinessType[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = Array.from(new Set(value)).filter(
    (businessType): businessType is TenantBusinessType =>
      typeof businessType === "string" &&
      TENANT_BUSINESS_TYPES.includes(businessType as TenantBusinessType),
  );
  return normalized.length > 0 && normalized.length === value.length ? normalized : null;
}

export async function getTenantBusinessTypes(tenantId: number): Promise<TenantBusinessType[]> {
  const rows = await db
    .select({ businessType: tenantBusinessTypesTable.businessType })
    .from(tenantBusinessTypesTable)
    .where(eq(tenantBusinessTypesTable.tenantId, tenantId));
  const businessTypes = normalizeBusinessTypes(rows.map((row) => row.businessType));
  return businessTypes ?? DEFAULT_TENANT_BUSINESS_TYPES;
}

export async function getFeatureAvailability(tenantId: number, businessTypes: TenantBusinessType[]) {
  const flags = await db.select().from(platformFeatureFlagsTable);
  const enabledKeys = new Set(flags.filter((flag) => flag.enabled).map((flag) => flag.key));
  const effectiveAccess = await getEffectiveFeatureAccess(tenantId);
  return entitledFeatures(businessTypes).map((feature) => ({
    ...feature,
    enabled: enabledKeys.has(feature.key)
      && (!effectiveAccess.billingConfigured || effectiveAccess.entitlements[feature.key] === true),
  }));
}

export async function replaceTenantBusinessTypes(
  tenantId: number,
  businessTypes: TenantBusinessType[],
) {
  await db.transaction(async (tx) => {
    await tx.delete(tenantBusinessTypesTable).where(eq(tenantBusinessTypesTable.tenantId, tenantId));
    await tx.insert(tenantBusinessTypesTable).values(
      businessTypes.map((businessType) => ({ tenantId, businessType })),
    );
  });
}

export function featureChanges(
  currentBusinessTypes: TenantBusinessType[],
  nextBusinessTypes: TenantBusinessType[],
) {
  const currentKeys = new Set(entitledFeatures(currentBusinessTypes).map((feature) => feature.key));
  const nextKeys = new Set(entitledFeatures(nextBusinessTypes).map((feature) => feature.key));
  return {
    addedFeatures: FEATURE_CATALOG.filter((feature) => nextKeys.has(feature.key) && !currentKeys.has(feature.key)),
    removedFeatures: FEATURE_CATALOG.filter((feature) => currentKeys.has(feature.key) && !nextKeys.has(feature.key)),
  };
}

export function businessTypesForTenantRows(
  rows: Array<{ businessType: string }>,
): TenantBusinessType[] {
  return normalizeBusinessTypes(rows.map((row) => row.businessType)) ?? DEFAULT_TENANT_BUSINESS_TYPES;
}