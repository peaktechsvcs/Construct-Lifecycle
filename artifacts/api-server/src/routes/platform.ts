import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  environmentsTable,
  membershipsTable,
  platformAuditEventsTable,
  tenantsTable,
  tenantInvitationsTable,
} from "@workspace/db";
import {
  CreatePlatformCustomerBody,
  UpdatePlatformCustomerBody,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requirePlatformAdmin } from "../middlewares/platformAdmin";
import { createTenantInvitation, serializeInvitation } from "./tenant-admin";

const router: IRouter = Router();

async function writeAudit(
  req: TenantRequest,
  action: string,
  tenantId: number | null,
  details: Record<string, unknown>,
) {
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId,
    action,
    details: JSON.stringify(details),
  });
}

async function serializeCustomer(tenant: typeof tenantsTable.$inferSelect) {
  const [{ memberCount }] = await db
    .select({ memberCount: sql<number>`count(*)::int` })
    .from(membershipsTable)
    .where(eq(membershipsTable.tenantId, tenant.id));
  const [{ invitationCount }] = await db
    .select({ invitationCount: sql<number>`count(*)::int` })
    .from(tenantInvitationsTable)
    .where(
      and(
        eq(tenantInvitationsTable.tenantId, tenant.id),
        sql`${tenantInvitationsTable.acceptedAt} is null`,
        sql`${tenantInvitationsTable.revokedAt} is null`,
        sql`${tenantInvitationsTable.expiresAt} > now()`,
      ),
    );
  const environments = await db
    .select({
      id: environmentsTable.id,
      name: environmentsTable.name,
      kind: environmentsTable.kind,
      status: environmentsTable.status,
    })
    .from(environmentsTable)
    .where(eq(environmentsTable.tenantId, tenant.id))
    .orderBy(environmentsTable.id);
  return {
    ...tenant,
    memberCount: Number(memberCount),
    pendingInvitationCount: Number(invitationCount),
    environments,
  };
}

router.use(requirePlatformAdmin);

router.get("/platform/customers", async (_req: TenantRequest, res) => {
  const tenants = await db.select().from(tenantsTable).orderBy(tenantsTable.name);
  const customers = await Promise.all(tenants.map(serializeCustomer));
  res.json(customers);
});

router.post("/platform/customers", async (req: TenantRequest, res) => {
  const parsed = CreatePlatformCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid customer", details: parsed.error.issues });
    return;
  }
  const slug = parsed.data.slug.trim().toLowerCase();
  const [existing] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, slug))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "Customer slug already exists" });
    return;
  }

  const [tenant] = await db
    .insert(tenantsTable)
    .values({ name: parsed.data.name.trim(), slug, status: "active" })
    .returning();
  await db.insert(environmentsTable).values([
    {
      tenantId: tenant.id,
      name: "Development / Test / Demo",
      slug: "development",
      kind: "dtd",
      status: "active",
    },
    {
      tenantId: tenant.id,
      name: "Production",
      slug: "production",
      kind: "production",
      status: "active",
    },
  ]);

  let invitation: ReturnType<typeof serializeInvitation> | null = null;
  let invitationToken: string | null = null;
  if (parsed.data.ownerEmail) {
    const created = await createTenantInvitation(
      tenant.id,
      req.localUserId!,
      parsed.data.ownerEmail,
      "owner",
    );
    invitation = serializeInvitation(created.invitation);
    invitationToken = created.token;
  }

  await writeAudit(req, "customer_created", tenant.id, {
    name: tenant.name,
    slug: tenant.slug,
    ownerEmail: parsed.data.ownerEmail ?? null,
  });
  res.status(201).json({ customer: await serializeCustomer(tenant), invitation, invitationToken });
});

router.patch("/platform/customers/:tenantId", async (req: TenantRequest, res) => {
  const tenantId = Number(req.params.tenantId);
  const parsed = UpdatePlatformCustomerBody.safeParse(req.body);
  if (!parsed.success || !Number.isInteger(tenantId) || tenantId < 1) {
    res.status(400).json({ error: "Invalid customer update" });
    return;
  }
  const [tenant] = await db
    .update(tenantsTable)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(tenantsTable.id, tenantId))
    .returning();
  if (!tenant) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  await writeAudit(req, "customer_status_changed", tenant.id, { status: tenant.status });
  res.json(await serializeCustomer(tenant));
});

export default router;