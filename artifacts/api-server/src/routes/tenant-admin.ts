import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  db,
  membershipsTable,
  tenantInvitationsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateTenantInvitationBody,
  UpdateTenantMemberBody,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { getCurrentTenantRole, requireRole } from "../middlewares/rbac";

const router: IRouter = Router();
const INVITATION_LIFETIME_DAYS = 7;

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function invitationStatus(invitation: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}) {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt) return "revoked";
  if (invitation.expiresAt.getTime() <= Date.now()) return "expired";
  return "pending";
}

export function serializeInvitation(invitation: typeof tenantInvitationsTable.$inferSelect) {
  return {
    id: invitation.id,
    tenantId: invitation.tenantId,
    email: invitation.email,
    role: invitation.role,
    status: invitationStatus(invitation),
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}

export async function createTenantInvitation(
  tenantId: number,
  invitedByUserId: number,
  email: string,
  role: string,
) {
  const token = randomBytes(32).toString("hex");
  const [invitation] = await db
    .insert(tenantInvitationsTable)
    .values({
      tenantId,
      invitedByUserId,
      email: email.trim().toLowerCase(),
      role,
      tokenHash: hashInvitationToken(token),
      expiresAt: new Date(
        Date.now() + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
      ),
    })
    .returning();

  return { invitation, token };
}

router.get(
  "/tenant/members",
  requireRole("owner", "admin", "member", "viewer"),
  async (req: TenantRequest, res) => {
    const members = await db
      .select({
        userId: usersTable.id,
        email: usersTable.email,
        displayName: usersTable.displayName,
        role: membershipsTable.role,
        joinedAt: membershipsTable.createdAt,
      })
      .from(membershipsTable)
      .innerJoin(usersTable, eq(membershipsTable.userId, usersTable.id))
      .where(eq(membershipsTable.tenantId, req.tenantId!))
      .orderBy(usersTable.displayName, usersTable.email);

    res.json(members);
  },
);

router.patch(
  "/tenant/members/:userId",
  requireRole("owner", "admin"),
  async (req: TenantRequest, res) => {
    const parsed = UpdateTenantMemberBody.safeParse(req.body);
    const userId = Number(req.params.userId);
    if (!parsed.success || !Number.isInteger(userId) || userId < 1) {
      res.status(400).json({ error: "Invalid membership update" });
      return;
    }

    const actorRole = await getCurrentTenantRole(req);
    if (parsed.data.role === "owner" && actorRole !== "owner") {
      res.status(403).json({ error: "Only an owner can assign owner access" });
      return;
    }

    const [membership] = await db
      .select()
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.tenantId, req.tenantId!),
          eq(membershipsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!membership) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    if (membership.role === "owner" && parsed.data.role !== "owner") {
      if (actorRole !== "owner") {
        res.status(403).json({ error: "Only an owner can change an owner's access" });
        return;
      }
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(membershipsTable)
        .where(
          and(
            eq(membershipsTable.tenantId, req.tenantId!),
            eq(membershipsTable.role, "owner"),
          ),
        );
      if (Number(count) <= 1) {
        res.status(409).json({ error: "A customer must retain one owner" });
        return;
      }
    }

    const [updated] = await db
      .update(membershipsTable)
      .set({ role: parsed.data.role })
      .where(
        and(
          eq(membershipsTable.tenantId, req.tenantId!),
          eq(membershipsTable.userId, userId),
        ),
      )
      .returning();
    const [updatedMember] = await db
      .select({
        userId: usersTable.id,
        email: usersTable.email,
        displayName: usersTable.displayName,
        role: membershipsTable.role,
        joinedAt: membershipsTable.createdAt,
      })
      .from(membershipsTable)
      .innerJoin(usersTable, eq(membershipsTable.userId, usersTable.id))
      .where(
        and(
          eq(membershipsTable.tenantId, req.tenantId!),
          eq(membershipsTable.userId, updated.userId),
        ),
      )
      .limit(1);
    res.json(updatedMember);
  },
);

router.delete(
  "/tenant/members/:userId",
  requireRole("owner", "admin"),
  async (req: TenantRequest, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) {
      res.status(400).json({ error: "Invalid member" });
      return;
    }
    if (userId === req.localUserId) {
      res.status(409).json({ error: "You cannot remove your own access" });
      return;
    }

    const [member] = await db
      .select()
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.tenantId, req.tenantId!),
          eq(membershipsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    if (member.role === "owner") {
      const actorRole = await getCurrentTenantRole(req);
      if (actorRole !== "owner") {
        res.status(403).json({ error: "Only an owner can remove an owner" });
        return;
      }
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(membershipsTable)
        .where(
          and(
            eq(membershipsTable.tenantId, req.tenantId!),
            eq(membershipsTable.role, "owner"),
          ),
        );
      if (Number(count) <= 1) {
        res.status(409).json({ error: "A customer must retain one owner" });
        return;
      }
    }

    await db
      .delete(membershipsTable)
      .where(
        and(
          eq(membershipsTable.tenantId, req.tenantId!),
          eq(membershipsTable.userId, userId),
        ),
      );
    res.status(204).send();
  },
);

router.get(
  "/tenant/invitations",
  requireRole("owner", "admin"),
  async (req: TenantRequest, res) => {
    const invitations = await db
      .select()
      .from(tenantInvitationsTable)
      .where(eq(tenantInvitationsTable.tenantId, req.tenantId!))
      .orderBy(sql`${tenantInvitationsTable.createdAt} desc`);
    res.json(invitations.map(serializeInvitation));
  },
);

router.post(
  "/tenant/invitations",
  requireRole("owner", "admin"),
  async (req: TenantRequest, res) => {
    const parsed = CreateTenantInvitationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid invitation", details: parsed.error.issues });
      return;
    }
    if (parsed.data.role === "owner" && (await getCurrentTenantRole(req)) !== "owner") {
      res.status(403).json({ error: "Only an owner can invite another owner" });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const [existingInvite] = await db
      .select()
      .from(tenantInvitationsTable)
      .where(
        and(
          eq(tenantInvitationsTable.tenantId, req.tenantId!),
          eq(tenantInvitationsTable.email, email),
          isNull(tenantInvitationsTable.acceptedAt),
          isNull(tenantInvitationsTable.revokedAt),
          gt(tenantInvitationsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (existingInvite) {
      res.status(409).json({ error: "An active invitation already exists for this email" });
      return;
    }

    const { invitation, token } = await createTenantInvitation(
      req.tenantId!,
      req.localUserId!,
      email,
      parsed.data.role,
    );
    res.status(201).json({ invitation: serializeInvitation(invitation), token });
  },
);

router.post(
  "/tenant/invitations/:invitationId/revoke",
  requireRole("owner", "admin"),
  async (req: TenantRequest, res) => {
    const invitationId = Number(req.params.invitationId);
    if (!Number.isInteger(invitationId) || invitationId < 1) {
      res.status(400).json({ error: "Invalid invitation" });
      return;
    }
    const [invitation] = await db
      .update(tenantInvitationsTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(tenantInvitationsTable.id, invitationId),
          eq(tenantInvitationsTable.tenantId, req.tenantId!),
          isNull(tenantInvitationsTable.acceptedAt),
          isNull(tenantInvitationsTable.revokedAt),
        ),
      )
      .returning();
    if (!invitation) {
      res.status(404).json({ error: "Active invitation not found" });
      return;
    }
    res.json(serializeInvitation(invitation));
  },
);

export default router;