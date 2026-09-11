import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  environmentsTable,
  membershipsTable,
  tenantInvitationsTable,
  tenantsTable,
  userTenantContextTable,
} from "@workspace/db";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireAuthenticatedUser } from "../middlewares/tenantContext";
import { hashInvitationToken, invitationStatus } from "./tenant-admin";

const router: IRouter = Router();

async function findInvitation(token: string) {
  const [result] = await db
    .select({
      invitation: tenantInvitationsTable,
      tenantName: tenantsTable.name,
      tenantStatus: tenantsTable.status,
    })
    .from(tenantInvitationsTable)
    .innerJoin(tenantsTable, eq(tenantInvitationsTable.tenantId, tenantsTable.id))
    .where(eq(tenantInvitationsTable.tokenHash, hashInvitationToken(token)))
    .limit(1);
  return result;
}

const ROLE_RANK: Record<string, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

function roleRank(role: string) {
  return ROLE_RANK[role] ?? 0;
}

function publicDetails(result: Awaited<ReturnType<typeof findInvitation>>) {
  if (!result) return null;
  const { invitation, tenantName, tenantStatus } = result;
  return {
    id: invitation.id,
    tenantId: invitation.tenantId,
    tenantName,
    email: invitation.email,
    role: invitation.role,
    status: tenantStatus === "active" ? invitationStatus(invitation) : "revoked",
    expiresAt: invitation.expiresAt,
  };
}

router.use(requireAuthenticatedUser);

router.get("/:token", async (req: TenantRequest, res) => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  const result = await findInvitation(token);
  const details = publicDetails(result);
  if (!details) {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }
  res.json(details);
});

router.post("/:token/accept", async (req: TenantRequest, res) => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  const result = await findInvitation(token);
  if (!result || !result.invitation) {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }
  const { invitation } = result;
  if (result.tenantStatus !== "active" || invitationStatus(invitation) !== "pending") {
    res.status(409).json({ error: "This invitation is no longer active" });
    return;
  }

  const [environment] = await db
    .select()
    .from(environmentsTable)
    .where(
      and(
        eq(environmentsTable.tenantId, invitation.tenantId),
        eq(environmentsTable.status, "active"),
      ),
    )
    .orderBy(environmentsTable.id)
    .limit(1);
  if (!environment) {
    res.status(409).json({ error: "Customer has no active environment" });
    return;
  }

  const [existingMembership] = await db
    .select({ role: membershipsTable.role })
    .from(membershipsTable)
    .where(
      and(
        eq(membershipsTable.tenantId, invitation.tenantId),
        eq(membershipsTable.userId, req.localUserId!),
      ),
    )
    .limit(1);
  const effectiveRole =
    existingMembership && roleRank(existingMembership.role) >= roleRank(invitation.role)
      ? existingMembership.role
      : invitation.role;

  await db
    .insert(membershipsTable)
    .values({
      tenantId: invitation.tenantId,
      userId: req.localUserId!,
      role: effectiveRole,
    })
    .onConflictDoUpdate({
      target: [membershipsTable.tenantId, membershipsTable.userId],
      set: { role: effectiveRole },
    });
  await db
    .update(tenantInvitationsTable)
    .set({ acceptedAt: new Date() })
    .where(
      and(
        eq(tenantInvitationsTable.id, invitation.id),
        isNull(tenantInvitationsTable.acceptedAt),
        isNull(tenantInvitationsTable.revokedAt),
      ),
    );
  await db
    .insert(userTenantContextTable)
    .values({
      userId: req.localUserId!,
      activeTenantId: invitation.tenantId,
      activeEnvironmentId: environment.id,
    })
    .onConflictDoUpdate({
      target: userTenantContextTable.userId,
      set: {
        activeTenantId: invitation.tenantId,
        activeEnvironmentId: environment.id,
        updatedAt: new Date(),
      },
    });

  res.json({ tenantId: invitation.tenantId, environmentId: environment.id });
});

export default router;