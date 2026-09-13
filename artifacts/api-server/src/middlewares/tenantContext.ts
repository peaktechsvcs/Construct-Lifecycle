import { clerkClient, getAuth } from "@clerk/express";
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

const DEFAULT_TENANT = { name: "Construct Lifecycle Demo", slug: "construct-lc-demo" };
const APP_ENV = process.env.APP_ENV ?? "development";
if (!["development", "demo", "test", "production"].includes(APP_ENV)) {
  throw new Error("APP_ENV must be one of development, demo, test, or production");
}

const authenticatedUser = (req: TenantRequest) => {
  if (APP_ENV === "test") {
    const testUserId = req.header("x-test-clerk-user-id");
    if (testUserId) {
      return {
        userId: testUserId,
        sessionClaims: {
          email: `${testUserId}@integration.test`,
          name: testUserId,
        },
      };
    }
  }
  return getAuth(req);
};

export type TenantRequest = Request & {
  tenantId?: number;
  environmentId?: number;
  localUserId?: number;
  environmentLabel?: string;
  isPlatformAdmin?: boolean;
};

async function upsertAuthenticatedUser(req: TenantRequest) {
  const auth = authenticatedUser(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) return null;
  const claims = auth.sessionClaims as Record<string, unknown> | undefined;
  let email = typeof claims?.email === "string" ? claims.email : undefined;
  let displayName =
    typeof claims?.name === "string"
      ? claims.name
      : typeof claims?.full_name === "string"
        ? claims.full_name
        : undefined;

  const [existingUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);

  // Replit-managed Clerk session claims do not always include profile fields.
  // Hydrate missing values from Clerk's server-side user resource instead of
  // persisting NULLs to the local user bridge.
  if (!email || !displayName) {
    try {
      const clerkUser = await clerkClient.users.getUser(clerkUserId);
      const primaryEmail = clerkUser.primaryEmailAddress;
      if (
        !email &&
        primaryEmail?.verification?.status === "verified"
      ) {
        email = primaryEmail.emailAddress;
      }
      if (!displayName) {
        displayName =
          clerkUser.fullName
          ?? ([clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || undefined);
      }
    } catch (error) {
      req.log?.warn({ err: error }, "failed to hydrate Clerk user profile");
    }
  }

  if (existingUser) {
    if (
      (email && email.toLowerCase() !== existingUser.email) ||
      (displayName && displayName !== existingUser.displayName)
    ) {
      const [updatedUser] = await db
        .update(usersTable)
        .set({
          ...(email ? { email: email.toLowerCase() } : {}),
          ...(displayName ? { displayName } : {}),
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, existingUser.id))
        .returning();
      req.localUserId = updatedUser.id;
      req.isPlatformAdmin = updatedUser.isPlatformAdmin;
      return updatedUser;
    }
    req.localUserId = existingUser.id;
    req.isPlatformAdmin = existingUser.isPlatformAdmin;
    return existingUser;
  }

  const [{ count: userCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable);

  const shouldBootstrapPlatformAdmin =
    APP_ENV !== "production" && Number(userCount) === 0;

  const [user] = await db
    .insert(usersTable)
    .values({
      clerkUserId,
      email: email?.toLowerCase(),
      displayName,
      isPlatformAdmin: shouldBootstrapPlatformAdmin,
    })
    .onConflictDoUpdate({
      target: usersTable.clerkUserId,
      set: { updatedAt: new Date() },
    })
    .returning();

  req.localUserId = user.id;
  req.isPlatformAdmin = user.isPlatformAdmin;
  return user;
}

export async function requireAuthenticatedUser(
  req: TenantRequest,
  res: Response,
  next: NextFunction,
) {
  if (!authenticatedUser(req)?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await upsertAuthenticatedUser(req);
    next();
  } catch (error) {
    req.log?.error(error, "failed to initialize authenticated user");
    res.status(500).json({ error: "Unable to initialize authenticated user" });
  }
}

export async function requireTenantContext(
  req: TenantRequest,
  res: Response,
  next: NextFunction,
) {
  if (!authenticatedUser(req)?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const user = await upsertAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let userMemberships = await db
      .select({
        tenantId: membershipsTable.tenantId,
        role: membershipsTable.role,
      })
      .from(membershipsTable)
      .where(eq(membershipsTable.userId, user.id));

    // Platform administrators can inspect any active customer workspace without
    // being copied into every customer's membership list. Keep the synthetic
    // role distinct from customer roles so tenant-admin mutations remain
    // customer-owner/admin controlled.
    if (user.isPlatformAdmin) {
      userMemberships = await db
        .select({
          tenantId: tenantsTable.id,
          role: sql<string>`'platform_admin'`,
        })
        .from(tenantsTable)
        .where(eq(tenantsTable.status, "active"));
    }

    // Preserve the populated demo experience for the first development user,
    // while keeping production access invitation/membership controlled.
    if (userMemberships.length === 0 && !user.isPlatformAdmin && APP_ENV !== "production") {
      const [{ count: membershipCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(membershipsTable);

      if (Number(membershipCount) === 0) {
        const [tenant] = await db
          .insert(tenantsTable)
          .values(DEFAULT_TENANT)
          .onConflictDoUpdate({
            target: tenantsTable.slug,
            set: { name: DEFAULT_TENANT.name, updatedAt: new Date() },
          })
          .returning();

        await db
          .insert(membershipsTable)
          .values({ tenantId: tenant.id, userId: user.id, role: "owner" })
          .onConflictDoNothing();

        userMemberships = [{ tenantId: tenant.id, role: "owner" }];
      }
    }

    if (userMemberships.length === 0) {
      res.status(403).json({
        error: "No customer access. Ask a customer owner to invite you.",
      });
      return;
    }

    const [savedContext] = await db
      .select()
      .from(userTenantContextTable)
      .where(eq(userTenantContextTable.userId, user.id))
      .limit(1);

    const activeTenantId = userMemberships.some(
      (membership) => membership.tenantId === savedContext?.activeTenantId,
    )
      ? savedContext!.activeTenantId
      : userMemberships[0].tenantId;

    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, activeTenantId))
      .limit(1);

    if (!tenant || tenant.status !== "active") {
      res.status(403).json({ error: "This customer workspace is not active." });
      return;
    }

    let [environment] = await db
      .select()
      .from(environmentsTable)
      .where(eq(environmentsTable.tenantId, tenant.id))
      .orderBy(
        sql`case when ${environmentsTable.kind} = 'dtd' then 0 else 1 end`,
        environmentsTable.id,
      )
      .limit(1);

    if (!environment && APP_ENV !== "production") {
      [environment] = await db
        .insert(environmentsTable)
        .values({
          tenantId: tenant.id,
          name: "Development",
          slug: "development",
          kind: "dtd",
          status: "active",
        })
        .returning();
    }

    if (!environment) {
      res.status(409).json({ error: "Customer has no active environment." });
      return;
    }

    const [savedEnvironment] = savedContext?.activeEnvironmentId
      ? await db
          .select()
          .from(environmentsTable)
          .where(
            and(
              eq(environmentsTable.id, savedContext.activeEnvironmentId),
              eq(environmentsTable.tenantId, tenant.id),
              eq(environmentsTable.status, "active"),
            ),
          )
          .limit(1)
      : [];

    await db
      .insert(userTenantContextTable)
      .values({
        userId: user.id,
        activeTenantId: tenant.id,
        activeEnvironmentId: savedEnvironment?.id ?? environment.id,
      })
      .onConflictDoUpdate({
        target: userTenantContextTable.userId,
        set: {
          activeTenantId: tenant.id,
          activeEnvironmentId: savedEnvironment?.id ?? environment.id,
          updatedAt: new Date(),
        },
      });

    req.tenantId = tenant.id;
    req.environmentId = savedEnvironment?.id ?? environment.id;
    req.environmentLabel = APP_ENV;
    next();
  } catch (error) {
    req.log?.error(error, "failed to provision tenant context");
    res.status(500).json({ error: "Unable to initialize tenant context" });
  }
}