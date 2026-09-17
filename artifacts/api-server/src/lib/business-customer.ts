import { and, eq } from "drizzle-orm";
import { businessCustomersTable, db, platformAuditEventsTable } from "@workspace/db";
import { getCurrentTenantRole } from "../middlewares/rbac";
import type { TenantRequest } from "../middlewares/tenantContext";

export type NewBusinessCustomerInput = {
  companyName: string;
  customerType?: string | null;
  primaryContact?: string | null;
  email?: string | null;
  phone?: string | null;
};

type CustomerResolution =
  | { customerId: number; customerName: string }
  | { status: number; error: string; existingCustomerId?: number };

type ScopedCustomer = {
  id: number;
  companyName: string;
  status: string;
};

export const normalizeBusinessCustomerName = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const loadScopedCustomerByName = async (req: TenantRequest, normalizedName: string): Promise<ScopedCustomer | undefined> => {
  const [customer] = await db
    .select({
      id: businessCustomersTable.id,
      companyName: businessCustomersTable.companyName,
      status: businessCustomersTable.status,
    })
    .from(businessCustomersTable)
    .where(and(
      eq(businessCustomersTable.tenantId, req.tenantId!),
      eq(businessCustomersTable.environmentId, req.environmentId!),
      eq(businessCustomersTable.normalizedName, normalizedName),
    ))
    .limit(1);
  return customer;
};

const isScopedCustomerNameConflict = (error: unknown) =>
  typeof error === "object"
  && error !== null
  && "code" in error
  && error.code === "23505"
  && "constraint" in error
  && error.constraint === "business_customers_tenant_environment_name_idx";

export const resolveBusinessCustomer = async (
  req: TenantRequest,
  input: {
    businessCustomerId?: number | null;
    newCustomer?: NewBusinessCustomerInput | null;
  },
): Promise<CustomerResolution> => {
  if (input.businessCustomerId && input.newCustomer) {
    return { status: 400, error: "Choose an existing customer or create a new one, not both" };
  }

  if (input.newCustomer) {
    const role = await getCurrentTenantRole(req);
    if (role !== "owner" && role !== "admin") {
      return { status: 403, error: "Customer creation permission required" };
    }

    const companyName = input.newCustomer.companyName.trim();
    const normalizedName = normalizeBusinessCustomerName(companyName);
    if (!companyName || !normalizedName) {
      return { status: 400, error: "Customer company name is required" };
    }

    const existing = await loadScopedCustomerByName(req, normalizedName);

    if (existing?.status === "archived") {
      return { status: 400, error: "An archived customer with this name already exists" };
    }
    if (existing) {
      return { customerId: existing.id, customerName: existing.companyName };
    }

    let created: { id: number; companyName: string } | undefined;
    try {
      [created] = await db.insert(businessCustomersTable).values({
        tenantId: req.tenantId!,
        environmentId: req.environmentId!,
        companyName,
        normalizedName,
        customerType: input.newCustomer.customerType?.trim() || "business",
        primaryContact: input.newCustomer.primaryContact?.trim() || null,
        email: input.newCustomer.email?.trim().toLowerCase() || null,
        phone: input.newCustomer.phone?.trim() || null,
      }).returning({
        id: businessCustomersTable.id,
        companyName: businessCustomersTable.companyName,
      });
    } catch (error) {
      if (!isScopedCustomerNameConflict(error)) throw error;
      const concurrentCustomer = await loadScopedCustomerByName(req, normalizedName);
      if (!concurrentCustomer) throw error;
      if (concurrentCustomer.status === "archived") {
        return { status: 400, error: "An archived customer with this name already exists" };
      }
      return { customerId: concurrentCustomer.id, customerName: concurrentCustomer.companyName };
    }

    if (!created) throw new Error("Business customer was not created");
    await db.insert(platformAuditEventsTable).values({
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      action: "business_customer_created",
      details: JSON.stringify({ customerId: created.id, environmentId: req.environmentId, source: "pipeline_create" }),
    });
    return { customerId: created.id, customerName: created.companyName };
  }

  if (!input.businessCustomerId) {
    return { status: 400, error: "A business customer is required" };
  }

  const [customer] = await db
    .select({
      id: businessCustomersTable.id,
      companyName: businessCustomersTable.companyName,
    })
    .from(businessCustomersTable)
    .where(and(
      eq(businessCustomersTable.id, input.businessCustomerId),
      eq(businessCustomersTable.tenantId, req.tenantId!),
      eq(businessCustomersTable.environmentId, req.environmentId!),
      eq(businessCustomersTable.status, "active"),
    ))
    .limit(1);

  return customer
    ? { customerId: customer.id, customerName: customer.companyName }
    : { status: 404, error: "Active business customer not found in this environment" };
};