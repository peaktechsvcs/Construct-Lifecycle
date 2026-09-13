import { and, eq } from "drizzle-orm";
import type { NextFunction, Response } from "express";
import type { TenantRequest } from "./tenantContext";

const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  owner: ["workspace:read", "workspace:write", "workspace:admin"],
  admin: ["workspace:read", "workspace:write", "workspace:admin"],
  member: ["workspace:read", "workspace:write"],
  viewer: ["workspace:read"],
  platform_admin: ["workspace:read", "workspace:write", "workspace:admin"],
};

export function permissionsForRole(role: string): string[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export const requireRole = (...roles: string[]) => async (req: TenantRequest, res: Response, next: NextFunction) => {
  if (req.runtimeEnvironmentId !== undefined) {
    if (!req.runtimeRole || !roles.includes(req.runtimeRole)) {
      res.status(403).json({ error: "Insufficient workspace permissions for this operation" });
      return;
    }
    next();
    return;
  }
  const { db, membershipsTable } = await import("@workspace/db");
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
  if (req.runtimeEnvironmentId !== undefined) return req.runtimeRole ?? "viewer";
  const { db, membershipsTable } = await import("@workspace/db");
  const [membership] = await db.select({ role: membershipsTable.role }).from(membershipsTable)
    .where(and(eq(membershipsTable.userId, req.localUserId!), eq(membershipsTable.tenantId, req.tenantId!)));
  return membership?.role;
}