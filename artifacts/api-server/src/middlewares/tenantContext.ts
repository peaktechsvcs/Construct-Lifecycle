import { getAuth } from "@clerk/express";
import { and, eq, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import {
  db,
  membershipsTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
} from "@workspace/db";

const DEFAULT_TENANT = { name: "Construct LC Demo", slug: "construct-lc-demo" };

export type TenantRequest = Request & { tenantId?: number; localUserId?: number };

export async function requireTenantContext(req: TenantRequest, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const [tenant] = await db
      .insert(tenantsTable).values(DEFAULT_TENANT)
      .onConflictDoUpdate({ target: tenantsTable.slug, set: { name: DEFAULT_TENANT.name } })
      .returning();
    const [user] = await db.insert(usersTable).values({ clerkUserId })
      .onConflictDoUpdate({ target: usersTable.clerkUserId, set: { updatedAt: new Date() } })
      .returning();
    const [{ count: userCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable);
    const [{ count: membershipCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(membershipsTable);
    if (Number(userCount) === 1 && Number(membershipCount) === 0) {
      await db.insert(membershipsTable).values({ tenantId: tenant.id, userId: user.id, role: "owner" }).onConflictDoNothing();
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
      await db.insert(userTenantContextTable).values({ userId: user.id, activeTenantId: tenant.id })
        .onConflictDoUpdate({ target: userTenantContextTable.userId, set: { activeTenantId: tenant.id, updatedAt: new Date() } });
      req.tenantId = tenant.id;
    } else req.tenantId = activeTenantId;
    await db.insert(userTenantContextTable).values({ userId: user.id, activeTenantId: req.tenantId })
      .onConflictDoUpdate({ target: userTenantContextTable.userId, set: { activeTenantId: req.tenantId, updatedAt: new Date() } });
    req.localUserId = user.id;
    next(); return;
  } catch (error) {
    req.log?.error(error, "failed to provision tenant context");
    res.status(500).json({ error: "Unable to initialize tenant context" });
  }
}