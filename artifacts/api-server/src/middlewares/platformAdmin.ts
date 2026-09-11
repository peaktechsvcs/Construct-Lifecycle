import { and, eq } from "drizzle-orm";
import type { NextFunction, Response } from "express";
import { db, usersTable } from "@workspace/db";
import type { TenantRequest } from "./tenantContext";

export async function requirePlatformAdmin(
  req: TenantRequest,
  res: Response,
  next: NextFunction,
) {
  if (!req.localUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [user] = await db
    .select({ isPlatformAdmin: usersTable.isPlatformAdmin })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, req.localUserId),
        eq(usersTable.isPlatformAdmin, true),
      ),
    )
    .limit(1);

  if (!user) {
    res.status(403).json({ error: "Platform administrator permission required" });
    return;
  }

  next();
}