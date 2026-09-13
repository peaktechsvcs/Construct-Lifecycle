import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  environmentsTable,
  membershipsTable,
  platformAuditEventsTable,
  tenantBusinessTypesTable,
  tenantEnvironmentAccessTable,
  tenantsTable,
  tenantInvitationsTable,
  usersTable,
  type TenantBusinessType,
} from "@workspace/db";
import {
  CreatePlatformCustomerInvitationBody,
  CreatePlatformCustomerBody,
  UpdatePlatformCustomerMemberBody,
  UpdatePlatformCustomerBody,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requirePlatformAdmin } from "../middlewares/platformAdmin";
import { createTenantInvitation, serializeInvitation } from "./tenant-admin";
import { ensurePublishedWorkflow } from "../lib/workflow";
import { DEFAULT_TENANT_BUSINESS_TYPES, getTenantBusinessTypes } from "../lib/tenant-business-profile";

const router: IRouter = Router();
const APP_ENV = process.env.APP_ENV ?? "development";

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
      slug: environmentsTable.slug,
      kind: environmentsTable.kind,
      status: environmentsTable.status,
    })
    .from(environmentsTable)
    .where(eq(environmentsTable.tenantId, tenant.id))
    .orderBy(environmentsTable.id);
  const businessTypes = await getTenantBusinessTypes(tenant.id);
  return {
    ...tenant,
    businessTypes,
    memberCount: Number(memberCount),
    pendingInvitationCount: Number(invitationCount),
    customerBrandingEnabled: tenant.customerBrandingEnabled,
    environments,
  };
}

async function getCustomer(tenantId: number) {
  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  return tenant;
}

async function serializeMember(tenantId: number, userId: number) {
  const [member] = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      displayName: usersTable.displayName,
      role: membershipsTable.role,
      joinedAt: membershipsTable.createdAt,
    })
    .from(membershipsTable)
    .innerJoin(usersTable, eq(membershipsTable.userId, usersTable.id))
    .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.userId, userId)))
    .limit(1);
  if (!member) return null;
  const access = await db
    .select({
      environmentId: tenantEnvironmentAccessTable.environmentId,
      environmentName: environmentsTable.name,
    })
    .from(tenantEnvironmentAccessTable)
    .innerJoin(environmentsTable, eq(tenantEnvironmentAccessTable.environmentId, environmentsTable.id))
    .where(
      and(
        eq(tenantEnvironmentAccessTable.tenantId, tenantId),
        eq(tenantEnvironmentAccessTable.userId, userId),
      ),
    )
    .orderBy(environmentsTable.name);
  return {
    ...member,
    environmentIds: access.map((environment) => environment.environmentId),
    environments: access.map(({ environmentId, environmentName }) => ({
      id: environmentId,
      name: environmentName,
    })),
  };
}

async function serializeCustomerDetails(tenant: typeof tenantsTable.$inferSelect) {
  const customer = await serializeCustomer(tenant);
  const members = await db
    .select({ userId: membershipsTable.userId })
    .from(membershipsTable)
    .where(eq(membershipsTable.tenantId, tenant.id))
    .orderBy(membershipsTable.userId);
  const invitations = await db
    .select()
    .from(tenantInvitationsTable)
    .where(eq(tenantInvitationsTable.tenantId, tenant.id))
    .orderBy(sql`${tenantInvitationsTable.createdAt} desc`);
  return {
    customer,
    members: (await Promise.all(members.map(({ userId }) => serializeMember(tenant.id, userId)))).filter(Boolean),
    invitations: invitations.map(serializeInvitation),
  };
}

router.post("/platform/bootstrap", async (req: TenantRequest, res) => {
  if (APP_ENV !== "production") {
    res.status(403).json({ error: "Production bootstrap is only available in production" });
    return;
  }
  const configuredToken = process.env.PLATFORM_BOOTSTRAP_TOKEN;
  const suppliedToken = req.header("x-platform-bootstrap-token");
  if (!configuredToken || !suppliedToken) {
    res.status(503).json({ error: "Platform bootstrap is not configured" });
    return;
  }
  const expected = createHash("sha256").update(configuredToken).digest();
  const supplied = createHash("sha256").update(suppliedToken).digest();
  if (!timingSafeEqual(expected, supplied)) {
    res.status(403).json({ error: "Invalid platform bootstrap token" });
    return;
  }
  const [existingAdmin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.isPlatformAdmin, true))
    .limit(1);
  if (existingAdmin) {
    res.status(409).json({ error: "A platform administrator already exists" });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ isPlatformAdmin: true, updatedAt: new Date() })
    .where(eq(usersTable.id, req.localUserId!))
    .returning({ id: usersTable.id });
  if (!updated) {
    res.status(401).json({ error: "Authenticated user not found" });
    return;
  }
  await writeAudit(req, "platform_bootstrapped", null, { userId: updated.id });
  res.status(201).json({ bootstrapped: true });
});

router.use("/platform", requirePlatformAdmin);

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
  const businessTypes = (parsed.data.businessTypes ?? DEFAULT_TENANT_BUSINESS_TYPES) as TenantBusinessType[];
  await db.insert(tenantBusinessTypesTable).values(
    businessTypes.map((businessType) => ({ tenantId: tenant.id, businessType })),
  );
  await db.insert(environmentsTable).values([
    {
      tenantId: tenant.id,
      name: "Development / Test / Demo",
      slug: "dtd",
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
  const environments = await db
    .select({ id: environmentsTable.id })
    .from(environmentsTable)
    .where(eq(environmentsTable.tenantId, tenant.id));
  await Promise.all(environments.map((environment) => ensurePublishedWorkflow(tenant.id, environment.id, req.localUserId)));

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
    businessTypes,
  });
  res.status(201).json({ customer: await serializeCustomer(tenant), invitation, invitationToken });
});

router.get("/platform/customers/:tenantId", async (req: TenantRequest, res) => {
  const tenantId = Number(req.params.tenantId);
  if (!Number.isInteger(tenantId) || tenantId < 1) {
    res.status(400).json({ error: "Invalid customer" });
    return;
  }
  const tenant = await getCustomer(tenantId);
  if (!tenant) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(await serializeCustomerDetails(tenant));
});

router.post("/platform/customers/:tenantId/invitations", async (req: TenantRequest, res) => {
  const tenantId = Number(req.params.tenantId);
  const parsed = CreatePlatformCustomerInvitationBody.safeParse(req.body);
  if (!Number.isInteger(tenantId) || tenantId < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid customer invitation" });
    return;
  }
  const tenant = await getCustomer(tenantId);
  if (!tenant) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  if (tenant.status !== "active") {
    res.status(409).json({ error: "Suspended customers cannot receive invitations" });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [existingInvite] = await db
    .select()
    .from(tenantInvitationsTable)
    .where(
      and(
        eq(tenantInvitationsTable.tenantId, tenantId),
        eq(tenantInvitationsTable.email, email),
        sql`${tenantInvitationsTable.acceptedAt} is null`,
        sql`${tenantInvitationsTable.revokedAt} is null`,
        sql`${tenantInvitationsTable.expiresAt} > now()`,
      ),
    )
    .limit(1);
  if (existingInvite) {
    res.status(409).json({ error: "An active invitation already exists for this email" });
    return;
  }
  const created = await createTenantInvitation(tenantId, req.localUserId!, email, parsed.data.role);
  res.status(201).json({
    invitation: serializeInvitation(created.invitation),
    token: created.token,
  });
});

router.patch("/platform/customers/:tenantId/members/:userId", async (req: TenantRequest, res) => {
  const tenantId = Number(req.params.tenantId);
  const userId = Number(req.params.userId);
  const parsed = UpdatePlatformCustomerMemberBody.safeParse(req.body);
  if (
    !Number.isInteger(tenantId) ||
    tenantId < 1 ||
    !Number.isInteger(userId) ||
    userId < 1 ||
    !parsed.success
  ) {
    res.status(400).json({ error: "Invalid customer member update" });
    return;
  }
  const tenant = await getCustomer(tenantId);
  if (!tenant) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  const [membership] = await db
    .select()
    .from(membershipsTable)
    .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.userId, userId)))
    .limit(1);
  if (!membership) {
    res.status(404).json({ error: "Customer member not found" });
    return;
  }
  if (membership.role === "owner" && parsed.data.role !== "owner") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(membershipsTable)
      .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.role, "owner")));
    if (Number(count) <= 1) {
      res.status(409).json({ error: "A customer must retain one owner" });
      return;
    }
  }
  if (parsed.data.environmentIds) {
    if (new Set(parsed.data.environmentIds).size !== parsed.data.environmentIds.length) {
      res.status(400).json({ error: "Environment access contains duplicate environments" });
      return;
    }
    const environments = await db
      .select({ id: environmentsTable.id })
      .from(environmentsTable)
      .where(
        and(
          eq(environmentsTable.tenantId, tenantId),
          inArray(environmentsTable.id, parsed.data.environmentIds),
          eq(environmentsTable.status, "active"),
        ),
      );
    if (environments.length !== parsed.data.environmentIds.length) {
      res.status(400).json({ error: "One or more environments are not active for this customer" });
      return;
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .update(membershipsTable)
      .set({ role: parsed.data.role, environmentAccessConfigured: parsed.data.environmentIds !== undefined ? true : undefined })
      .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.userId, userId)));
    if (parsed.data.environmentIds) {
      await tx
        .delete(tenantEnvironmentAccessTable)
        .where(and(eq(tenantEnvironmentAccessTable.tenantId, tenantId), eq(tenantEnvironmentAccessTable.userId, userId)));
      if (parsed.data.environmentIds.length > 0) {
        await tx.insert(tenantEnvironmentAccessTable).values(
          parsed.data.environmentIds.map((environmentId) => ({
            tenantId,
            environmentId,
            userId,
            grantedByUserId: req.localUserId!,
          })),
        );
      }
    }
  });
  await writeAudit(req, "customer_member_access_updated", tenantId, {
    userId,
    role: parsed.data.role,
    environmentIds: parsed.data.environmentIds,
  });
  res.json(await serializeMember(tenantId, userId));
});

router.delete("/platform/customers/:tenantId/members/:userId", async (req: TenantRequest, res) => {
  const tenantId = Number(req.params.tenantId);
  const userId = Number(req.params.userId);
  if (!Number.isInteger(tenantId) || tenantId < 1 || !Number.isInteger(userId) || userId < 1) {
    res.status(400).json({ error: "Invalid customer member" });
    return;
  }
  const [membership] = await db
    .select()
    .from(membershipsTable)
    .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.userId, userId)))
    .limit(1);
  if (!membership) {
    res.status(404).json({ error: "Customer member not found" });
    return;
  }
  if (membership.role === "owner") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(membershipsTable)
      .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.role, "owner")));
    if (Number(count) <= 1) {
      res.status(409).json({ error: "A customer must retain one owner" });
      return;
    }
  }
  await db
    .delete(membershipsTable)
    .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.userId, userId)));
  await writeAudit(req, "customer_member_removed", tenantId, { userId });
  res.status(204).send();
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
    .set({
      status: parsed.data.status,
      ...(parsed.data.customerBrandingEnabled === undefined
        ? {}
        : { customerBrandingEnabled: parsed.data.customerBrandingEnabled }),
      updatedAt: new Date(),
    })
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