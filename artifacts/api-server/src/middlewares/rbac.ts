import { and, eq } from "drizzle-orm";
import type { NextFunction, Response } from "express";
import { db, membershipsTable } from "@workspace/db";
import type { TenantRequest } from "./tenantContext";

export const requireRole = (...roles: string[]) => async (req: TenantRequest, res: Response, next: NextFunction) => {
  const [membership] = await db.select({ role: membershipsTable.role }).from(membershipsTable)
    .where(and(eq(membershipsTable.userId, req.localUserId!), eq(membershipsTable.tenantId, req.tenantId!)));
  if (!membership || !roles.includes(membership.role)) {
    res.status(403).json({ error: "Insufficient workspace permissions for this operation" });
    return;
  }
  next();
};

/** Workflow configuration is a platform-operated control surface as well as a tenant-admin surface. */
export const requireWorkflowManager = (...roles: string[]) => async (req: TenantRequest, res: Response, next: NextFunction) => {
  if (req.isPlatformAdmin) {
    next();
    return;
  }
  return requireRole(...roles)(req, res, next);
};

export async function getCurrentTenantRole(req: TenantRequest) {
  const [membership] = await db.select({ role: membershipsTable.role }).from(membershipsTable)
    .where(and(eq(membershipsTable.userId, req.localUserId!), eq(membershipsTable.tenantId, req.tenantId!)));
  return membership?.role;
}