import { clerkClient, getAuth } from "@clerk/express";
import { and, eq, sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import {
  db,
  environmentsTable,
  membershipsTable,
  tenantEnvironmentAccessTable,
  tenantsTable,
  userTenantContextTable,
  usersTable,
  environmentResourcesTable,
  environmentHealthChecksTable,
} from "@workspace/db";
import { isIsolatedEnvironmentReady, isRecentHealthyCheck, isRuntimeSigningBoundaryReady } from "../lib/provisioning";
import {
  shouldBootstrapDefaultTenant,
  shouldCreateDevelopmentEnvironment,
} from "../lib/development-bootstrap";

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
  runtimeTenantId?: number;
  runtimeEnvironmentId?: number;
  runtimeUserId?: number;
  runtimeRole?: string;
  runtimePermissions?: string[];
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
    // while keeping production access invitation/membership controlled. A
    // platform-admin flag is assigned before this middleware resolves a
    // tenant, so the first development request must also seed the default
    // tenant when the previous bootstrap stopped after creating the user.
    const membershipCount = !user.isPlatformAdmin && userMemberships.length === 0
      ? Number((await db
        .select({ count: sql<number>`count(*)::int` })
        .from(membershipsTable))[0]?.count ?? 0)
      : 0;
    if (shouldBootstrapDefaultTenant({
      appEnv: APP_ENV,
      isPlatformAdmin: user.isPlatformAdmin,
      hasUserMemberships: userMemberships.length > 0,
      membershipCount,
    })) {
      const [tenant] = await db
        .insert(tenantsTable)
        .values(DEFAULT_TENANT)
        .onConflictDoUpdate({
          target: tenantsTable.slug,
          set: { name: DEFAULT_TENANT.name, status: "active", updatedAt: new Date() },
        })
        .returning();

      if (!user.isPlatformAdmin) {
        await db
          .insert(membershipsTable)
          .values({ tenantId: tenant.id, userId: user.id, role: "owner" })
          .onConflictDoNothing();
      }

      userMemberships = [{
        tenantId: tenant.id,
        role: user.isPlatformAdmin ? "platform_admin" : "owner",
      }];
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

    if (!user.isPlatformAdmin) {
      const [membership] = await db
        .select({ environmentAccessConfigured: membershipsTable.environmentAccessConfigured })
        .from(membershipsTable)
        .where(and(eq(membershipsTable.tenantId, tenant.id), eq(membershipsTable.userId, user.id)))
        .limit(1);
      // Backfill memberships created before per-environment access existed.
      // Once rows exist, an empty set is meaningful and denies environment access.
      if (membership?.environmentAccessConfigured !== true) {
        const legacyEnvironments = await db
          .select({ id: environmentsTable.id })
          .from(environmentsTable)
          .where(eq(environmentsTable.tenantId, tenant.id));
        if (legacyEnvironments.length > 0) {
          await db.insert(tenantEnvironmentAccessTable).values(
            legacyEnvironments.map((environment) => ({
              tenantId: tenant.id,
              environmentId: environment.id,
              userId: user.id,
              grantedByUserId: user.id,
            })),
          ).onConflictDoNothing();
        }
        await db
          .update(membershipsTable)
          .set({ environmentAccessConfigured: true })
          .where(and(eq(membershipsTable.tenantId, tenant.id), eq(membershipsTable.userId, user.id)));
      }
    }

    let [environment] = await db
      .select()
      .from(environmentsTable)
      .where(
        user.isPlatformAdmin
          ? eq(environmentsTable.tenantId, tenant.id)
          : and(
              eq(environmentsTable.tenantId, tenant.id),
              sql`exists (
                select 1 from tenant_environment_access access
                where access.tenant_id = ${tenant.id}
                  and access.environment_id = ${environmentsTable.id}
                  and access.user_id = ${user.id}
              )`,
            ),
      )
      .orderBy(
        sql`case when ${environmentsTable.kind} = 'dtd' then 0 else 1 end`,
        environmentsTable.id,
      )
      .limit(1);

    if (shouldCreateDevelopmentEnvironment({
      appEnv: APP_ENV,
      hasEnvironment: Boolean(environment),
    })) {
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
              user.isPlatformAdmin
                ? sql`true`
                : sql`exists (
                    select 1 from tenant_environment_access access
                    where access.tenant_id = ${tenant.id}
                      and access.environment_id = ${environmentsTable.id}
                      and access.user_id = ${user.id}
                  )`,
            ),
          )
          .limit(1)
      : [];

    const selectedEnvironment = savedEnvironment?.id ? savedEnvironment : environment;
    const selectedResources = await db
      .select({
        resourceType: environmentResourcesTable.resourceType,
        status: environmentResourcesTable.status,
        secretReference: environmentResourcesTable.secretReference,
      })
      .from(environmentResourcesTable)
      .where(eq(environmentResourcesTable.environmentId, selectedEnvironment.id));
    const [latestHealthCheck] = await db
      .select({ status: environmentHealthChecksTable.status, checkedAt: environmentHealthChecksTable.checkedAt })
      .from(environmentHealthChecksTable)
      .where(eq(environmentHealthChecksTable.environmentId, selectedEnvironment.id))
      .orderBy(sql`${environmentHealthChecksTable.checkedAt} desc`)
      .limit(1);
    if (
      selectedEnvironment.isolationEnforced &&
      (!isIsolatedEnvironmentReady(selectedResources) || !isRuntimeSigningBoundaryReady(selectedResources) || !isRecentHealthyCheck(latestHealthCheck))
    ) {
      res.status(409).json({
        error: "Customer environment is not ready",
        details: "An isolated runtime, database, storage, queue, secrets, jobs, and logs resource plus a recent successful health check are required.",
        environmentId: selectedEnvironment.id,
      });
      return;
    }

    await db
      .insert(userTenantContextTable)
      .values({
        userId: user.id,
        activeTenantId: tenant.id,
         activeEnvironmentId: selectedEnvironment.id,
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
    req.environmentId = selectedEnvironment.id;
    req.environmentLabel = APP_ENV;
    next();
  } catch (error) {
    req.log?.error(error, "failed to provision tenant context");
    res.status(500).json({ error: "Unable to initialize tenant context" });
  }
}