import { getAuth } from "@clerk/express";
import { and, eq, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import {
  db,
  environmentsTable,
  membershipsTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} from "@workspace/db";

const DEFAULT_TENANT = { name: "Construct LC Demo", slug: "construct-lc-demo" };
const APP_ENV = process.env.APP_ENV ?? "development";
if (!["development", "demo", "production"].includes(APP_ENV)) {
  throw new Error("APP_ENV must be one of development, demo, or production");
}

export type TenantRequest = Request & { tenantId?: number; environmentId?: number; localUserId?: number; environmentLabel?: string };

export async function requireTenantContext(req: TenantRequest, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const [user] = await db.insert(usersTable).values({ clerkUserId })
      .onConflictDoUpdate({ target: usersTable.clerkUserId, set: { updatedAt: new Date() } })
      .returning();
    const [{ count: membershipCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(membershipsTable);
    let tenant = (await db.select().from(tenantsTable).limit(1))[0];
    if (!tenant && APP_ENV !== "production" && Number(membershipCount) === 0) {
      [tenant] = await db.insert(tenantsTable).values(DEFAULT_TENANT).returning();
      await db.insert(membershipsTable).values({ tenantId: tenant.id, userId: user.id, role: "owner" }).onConflictDoNothing();
    }
    if (!tenant) {
      res.status(403).json({ error: "No customer access. Ask a customer owner to invite you." });
      return;
    }
    let environment = (await db.select().from(environmentsTable)
      .where(eq(environmentsTable.tenantId, tenant.id))
      .orderBy(sql`case when ${environmentsTable.kind} = 'dtd' then 0 else 1 end`, environmentsTable.id)
      .limit(1))[0];
    if (!environment && APP_ENV !== "production") {
      [environment] = await db.insert(environmentsTable).values({
        tenantId: tenant.id, name: "Development", slug: "development", kind: "dtd", status: "active",
      }).returning();
    }
    const [context] = await db.select().from(userTenantContextTable)
      .where(eq(userTenantContextTable.userId, user.id));
    const activeTenantId = context?.activeTenantId ?? tenant.id;
    const [membership] = await db.select().from(membershipsTable)
      .where(and(eq(membershipsTable.userId, user.id), eq(membershipsTable.tenantId, activeTenantId)));
    if (!membership) {
      const [defaultMembership] = await db.select().from(membershipsTable)
        .where(and(eq(membershipsTable.userId, user.id), eq(membershipsTable.tenantId, tenant.id)));
      if (!defaultMembership) {
        res.status(403).json({ error: "No workspace access. Ask a workspace owner to invite you." });
        return;
      }
       await db.insert(userTenantContextTable).values({ userId: user.id, activeTenantId: tenant.id, activeEnvironmentId: environment?.id })
         .onConflictDoUpdate({ target: userTenantContextTable.userId, set: { activeTenantId: tenant.id, activeEnvironmentId: environment?.id, updatedAt: new Date() } });
      req.tenantId = tenant.id;
     } else req.tenantId = activeTenantId;
     const contextEnvironmentId = context?.activeEnvironmentId;
     const [activeEnvironment] = await db.select().from(environmentsTable).where(and(
       eq(environmentsTable.tenantId, req.tenantId), eq(environmentsTable.id, contextEnvironmentId ?? environment?.id ?? 0),
     ));
     req.environmentId = activeEnvironment?.id ?? environment?.id;
     req.environmentLabel = APP_ENV;
     await db.insert(userTenantContextTable).values({ userId: user.id, activeTenantId: req.tenantId, activeEnvironmentId: req.environmentId })
       .onConflictDoUpdate({ target: userTenantContextTable.userId, set: { activeTenantId: req.tenantId, activeEnvironmentId: req.environmentId, updatedAt: new Date() } });
    req.localUserId = user.id;
    next(); return;
  } catch (error) {
    req.log?.error(error, "failed to provision tenant context");
    res.status(500).json({ error: "Unable to initialize tenant context" });
  }
}