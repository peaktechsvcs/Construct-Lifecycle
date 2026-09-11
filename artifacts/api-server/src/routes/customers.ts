import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  businessCustomersTable,
  db,
  platformAuditEventsTable,
  projectsTable,
} from "@workspace/db";
import {
  CreateBusinessCustomerBody,
  GetBusinessCustomerParams,
  UpdateBusinessCustomerBody,
  UpdateBusinessCustomerParams,
  ListBusinessCustomersQueryParams,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";

const router: IRouter = Router();

export const normalizeCustomerName = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const customerSummary = (customer: typeof businessCustomersTable.$inferSelect, projectCount: number) => ({
  id: customer.id,
  companyName: customer.companyName,
  customerType: customer.customerType,
  status: customer.status,
  projectCount,
});

const customerDetail = (
  customer: typeof businessCustomersTable.$inferSelect,
  projects: Array<typeof projectsTable.$inferSelect>,
) => ({
  ...customerSummary(customer, projects.length),
  primaryContact: customer.primaryContact,
  email: customer.email,
  phone: customer.phone,
  createdAt: customer.createdAt,
  updatedAt: customer.updatedAt,
  projects: projects.map((project) => ({
    id: project.id,
    projectNumber: project.projectNumber,
    projectName: project.projectName,
    customerName: customer.companyName,
    stage: project.stage,
    contractValue: Number(project.contractValue),
    updatedAt: project.updatedAt,
  })),
});

const getCustomerInContext = async (req: TenantRequest, customerId: number) => {
  const [customer] = await db
    .select()
    .from(businessCustomersTable)
    .where(and(
      eq(businessCustomersTable.id, customerId),
      eq(businessCustomersTable.tenantId, req.tenantId!),
      eq(businessCustomersTable.environmentId, req.environmentId!),
    ));
  return customer;
};

router.get("/customers", async (req: TenantRequest, res) => {
  const parsed = ListBusinessCustomersQueryParams.safeParse({
    search: req.query.search,
    includeArchived: req.query.includeArchived,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid customer search" });
    return;
  }

  const conditions = [
    eq(businessCustomersTable.tenantId, req.tenantId!),
    eq(businessCustomersTable.environmentId, req.environmentId!),
  ];
  if (!parsed.data.includeArchived) {
    conditions.push(eq(businessCustomersTable.status, "active"));
  }
  if (parsed.data.search) {
    const term = `%${parsed.data.search}%`;
    const searchCondition = or(
      ilike(businessCustomersTable.companyName, term),
      ilike(businessCustomersTable.primaryContact, term),
      ilike(businessCustomersTable.email, term),
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  const rows = await db
    .select({
      customer: businessCustomersTable,
      projectCount: sql<number>`count(${projectsTable.id})::int`,
    })
    .from(businessCustomersTable)
    .leftJoin(projectsTable, and(
      eq(projectsTable.businessCustomerId, businessCustomersTable.id),
      eq(projectsTable.tenantId, req.tenantId!),
      eq(projectsTable.environmentId, req.environmentId!),
    ))
    .where(and(...conditions))
    .groupBy(businessCustomersTable.id)
    .orderBy(asc(businessCustomersTable.companyName))
    .limit(100);

  res.json(rows.map(({ customer, projectCount }) => customerSummary(customer, Number(projectCount))));
});

router.post("/customers", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const parsed = CreateBusinessCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid customer details", details: parsed.error.issues });
    return;
  }
  const normalizedName = normalizeCustomerName(parsed.data.companyName);
  const [existing] = await db
    .select({ id: businessCustomersTable.id })
    .from(businessCustomersTable)
    .where(and(
      eq(businessCustomersTable.tenantId, req.tenantId!),
      eq(businessCustomersTable.environmentId, req.environmentId!),
      eq(businessCustomersTable.normalizedName, normalizedName),
    ));
  if (existing) {
    res.status(409).json({ error: "A customer with this name already exists", existingCustomerId: existing.id });
    return;
  }

  const [customer] = await db.insert(businessCustomersTable).values({
    tenantId: req.tenantId!,
    environmentId: req.environmentId!,
    companyName: parsed.data.companyName.trim(),
    normalizedName,
    customerType: parsed.data.customerType?.trim() || "business",
    primaryContact: parsed.data.primaryContact?.trim() || null,
    email: parsed.data.email?.trim().toLowerCase() || null,
    phone: parsed.data.phone?.trim() || null,
  }).returning();
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId: req.tenantId!,
    action: "business_customer_created",
    details: JSON.stringify({ customerId: customer.id, environmentId: req.environmentId }),
  });
  res.status(201).json(customerDetail(customer, []));
});

router.get("/customers/:customerId", async (req: TenantRequest, res) => {
  const params = GetBusinessCustomerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid customer id" });
    return;
  }
  const customer = await getCustomerInContext(req, params.data.customerId);
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  const projects = await db.select().from(projectsTable)
    .where(and(
      eq(projectsTable.businessCustomerId, customer.id),
      eq(projectsTable.tenantId, req.tenantId!),
      eq(projectsTable.environmentId, req.environmentId!),
    ))
    .orderBy(desc(projectsTable.updatedAt));
  res.json(customerDetail(customer, projects));
});

router.patch("/customers/:customerId", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const params = UpdateBusinessCustomerParams.safeParse(req.params);
  const parsed = UpdateBusinessCustomerBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid customer update" });
    return;
  }
  const customer = await getCustomerInContext(req, params.data.customerId);
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  const normalizedName = parsed.data.companyName === undefined
    ? customer.normalizedName
    : normalizeCustomerName(parsed.data.companyName);
  if (normalizedName !== customer.normalizedName) {
    const [existing] = await db.select({ id: businessCustomersTable.id })
      .from(businessCustomersTable)
      .where(and(
        eq(businessCustomersTable.tenantId, req.tenantId!),
        eq(businessCustomersTable.environmentId, req.environmentId!),
        eq(businessCustomersTable.normalizedName, normalizedName),
      ));
    if (existing && existing.id !== customer.id) {
      res.status(409).json({ error: "A customer with this name already exists", existingCustomerId: existing.id });
      return;
    }
  }

  const [updated] = await db.transaction(async (tx) => {
    const [next] = await tx.update(businessCustomersTable).set({
      ...(parsed.data.companyName !== undefined ? {
        companyName: parsed.data.companyName.trim(),
        normalizedName,
      } : {}),
      ...(parsed.data.customerType !== undefined ? { customerType: parsed.data.customerType.trim() } : {}),
      ...(parsed.data.primaryContact !== undefined ? { primaryContact: parsed.data.primaryContact?.trim() || null } : {}),
      ...(parsed.data.email !== undefined ? { email: parsed.data.email?.trim().toLowerCase() || null } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone?.trim() || null } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      updatedAt: new Date(),
    }).where(and(
      eq(businessCustomersTable.id, customer.id),
      eq(businessCustomersTable.tenantId, req.tenantId!),
      eq(businessCustomersTable.environmentId, req.environmentId!),
    )).returning();

    if (parsed.data.companyName !== undefined) {
      await tx.update(projectsTable)
        .set({ customerName: parsed.data.companyName.trim(), updatedAt: new Date() })
        .where(and(
          eq(projectsTable.businessCustomerId, customer.id),
          eq(projectsTable.tenantId, req.tenantId!),
          eq(projectsTable.environmentId, req.environmentId!),
        ));
    }
    await tx.insert(platformAuditEventsTable).values({
      actorUserId: req.localUserId!,
      tenantId: req.tenantId!,
      action: parsed.data.status === "archived" ? "business_customer_archived" : "business_customer_updated",
      details: JSON.stringify({ customerId: customer.id, environmentId: req.environmentId }),
    });
    return [next];
  });

  const projects = await db.select().from(projectsTable)
    .where(and(
      eq(projectsTable.businessCustomerId, updated.id),
      eq(projectsTable.tenantId, req.tenantId!),
      eq(projectsTable.environmentId, req.environmentId!),
    ))
    .orderBy(desc(projectsTable.updatedAt));
  res.json(customerDetail(updated, projects));
});

export default router;