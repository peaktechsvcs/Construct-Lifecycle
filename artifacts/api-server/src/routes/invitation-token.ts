import { Router, type IRouter } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  db,
  environmentsTable,
  membershipsTable,
  tenantEnvironmentAccessTable,
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
  const outcome = await db.transaction(async (tx) => {
    const [result] = await tx
      .select({
        invitation: tenantInvitationsTable,
        tenantStatus: tenantsTable.status,
      })
      .from(tenantInvitationsTable)
      .innerJoin(tenantsTable, eq(tenantInvitationsTable.tenantId, tenantsTable.id))
      .where(eq(tenantInvitationsTable.tokenHash, hashInvitationToken(token)))
      .limit(1);
    if (!result || !result.invitation) {
      return { status: "not_found" as const };
    }

    const { invitation } = result;
    if (result.tenantStatus !== "active" || invitationStatus(invitation) !== "pending") {
      return { status: "inactive" as const };
    }

    const [environment] = await tx
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
      return { status: "no_environment" as const };
    }

    // Claim the invitation before changing membership. Revocation uses the
    // same conditional update, so whichever transaction claims the row first
    // wins and a revoked invitation cannot be accepted after the race.
    const [claimed] = await tx
      .update(tenantInvitationsTable)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(tenantInvitationsTable.id, invitation.id),
          isNull(tenantInvitationsTable.acceptedAt),
          isNull(tenantInvitationsTable.revokedAt),
          gt(tenantInvitationsTable.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!claimed) {
      return { status: "inactive" as const };
    }

    const [existingMembership] = await tx
      .select({ role: membershipsTable.role })
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.tenantId, claimed.tenantId),
          eq(membershipsTable.userId, req.localUserId!),
        ),
      )
      .limit(1);
    const effectiveRole =
      existingMembership && roleRank(existingMembership.role) >= roleRank(claimed.role)
        ? existingMembership.role
        : claimed.role;

    await tx
      .insert(membershipsTable)
      .values({
        tenantId: claimed.tenantId,
        userId: req.localUserId!,
        role: effectiveRole,
      })
      .onConflictDoUpdate({
        target: [membershipsTable.tenantId, membershipsTable.userId],
        set: { role: effectiveRole, environmentAccessConfigured: true },
      });
    await tx.insert(tenantEnvironmentAccessTable).values(
      (await tx
        .select({ id: environmentsTable.id })
        .from(environmentsTable)
        .where(
          and(
            eq(environmentsTable.tenantId, claimed.tenantId),
            eq(environmentsTable.status, "active"),
          ),
        ))
        .map((activeEnvironment) => ({
          tenantId: claimed.tenantId,
          environmentId: activeEnvironment.id,
          userId: req.localUserId!,
          grantedByUserId: req.localUserId!,
        })),
    ).onConflictDoNothing();
    await tx
      .insert(userTenantContextTable)
      .values({
        userId: req.localUserId!,
        activeTenantId: claimed.tenantId,
        activeEnvironmentId: environment.id,
      })
      .onConflictDoUpdate({
        target: userTenantContextTable.userId,
        set: {
          activeTenantId: claimed.tenantId,
          activeEnvironmentId: environment.id,
          updatedAt: new Date(),
        },
      });

    return {
      status: "accepted" as const,
      tenantId: claimed.tenantId,
      environmentId: environment.id,
    };
  });

  if (outcome.status === "not_found") {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }
  if (outcome.status === "inactive") {
    res.status(409).json({ error: "This invitation is no longer active" });
    return;
  }
  if (outcome.status === "no_environment") {
    res.status(409).json({ error: "Customer has no active environment" });
    return;
  }
  res.json({ tenantId: outcome.tenantId, environmentId: outcome.environmentId });
});

export default router;