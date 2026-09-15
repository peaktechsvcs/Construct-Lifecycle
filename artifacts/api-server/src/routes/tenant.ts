import { Router, type IRouter, type NextFunction, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  environmentsTable,
  environmentReleaseAssignmentsTable,
  membershipsTable,
  tenantEnvironmentAccessTable,
  platformAuditEventsTable,
  platformReleasesTable,
  releaseAssignmentEventsTable,
  usersTable,
  tenantBrandingDraftsTable,
  tenantBrandingVersionsTable,
  tenantsTable,
  userTenantContextTable,
  environmentResourcesTable,
  environmentHealthChecksTable,
} from "@workspace/db";
import {
  SaveBrandingDraftBody,
  SwitchEnvironmentBody,
  SwitchTenantBody,
  RollbackBrandingParams,
  UpdateTenantBusinessProfileBody,
  RejectTenantReleaseBody,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";
import {
  featureChanges,
  getFeatureAvailability,
  getTenantBusinessTypes,
  normalizeBusinessTypes,
  replaceTenantBusinessTypes,
} from "../lib/tenant-business-profile";
import { isIsolatedEnvironmentReady, isRecentHealthyCheck, isRuntimeSigningBoundaryReady } from "../lib/provisioning";

const router: IRouter = Router();
const releaseAssignment = async (assignmentId: number, tenantId: number, userId: number, isPlatformAdmin = false) => {
  const [row] = await db
    .select({
      assignment: environmentReleaseAssignmentsTable,
      release: platformReleasesTable,
      environment: environmentsTable,
    })
    .from(environmentReleaseAssignmentsTable)
    .innerJoin(platformReleasesTable, eq(environmentReleaseAssignmentsTable.releaseId, platformReleasesTable.id))
    .innerJoin(environmentsTable, eq(environmentReleaseAssignmentsTable.environmentId, environmentsTable.id))
    .where(and(
      eq(environmentReleaseAssignmentsTable.id, assignmentId),
      eq(environmentsTable.tenantId, tenantId),
      isPlatformAdmin
        ? sql`true`
        : sql`exists (
          select 1 from tenant_environment_access access
          where access.tenant_id = ${tenantId}
            and access.environment_id = ${environmentsTable.id}
            and access.user_id = ${userId}
        )`,
    ))
    .limit(1);
  return row;
};

type ReleaseActorNames = ReadonlyMap<number, string>;

const releaseActorNames = async (events: (typeof releaseAssignmentEventsTable.$inferSelect)[]) => {
  const actorIds = [...new Set(events.flatMap((event) => event.actorUserId === null ? [] : [event.actorUserId]))];
  if (actorIds.length === 0) return new Map<number, string>();
  const users = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(inArray(usersTable.id, actorIds));
  return new Map(users.map((user) => [
    user.id,
    user.displayName?.trim() || "Unavailable user",
  ]));
};

const serializeReleaseEvent = (
  event: typeof releaseAssignmentEventsTable.$inferSelect,
  actors: ReleaseActorNames = new Map(),
) => ({
  ...event,
  actorDisplayName: event.actorUserId === null
    ? "Legacy actor"
    : actors.get(event.actorUserId) ?? "Unavailable user",
  details: parse(event.details),
});
const assignmentWithEvents = async (assignment: typeof environmentReleaseAssignmentsTable.$inferSelect) => {
  const events = await db.select().from(releaseAssignmentEventsTable)
    .where(eq(releaseAssignmentEventsTable.assignmentId, assignment.id))
    .orderBy(releaseAssignmentEventsTable.occurredAt);
  const actors = await releaseActorNames(events);
  return {
    ...assignment,
    events: events.map((event) => serializeReleaseEvent(event, actors)),
  };
};

const writeReleaseTransition = async (
  tx: any,
  actorUserId: number,
  releaseId: number,
  assignmentId: number,
  action: string,
  fromStatus: string | null,
  toStatus: string | null,
  details: Record<string, unknown> = {},
) => {
  await tx.insert(releaseAssignmentEventsTable).values({
    actorUserId,
    releaseId,
    assignmentId,
    action,
    fromStatus,
    toStatus,
    details: JSON.stringify(details),
  });
};

const releaseAdmin = async (req: TenantRequest, res: Response, next: NextFunction) => {
  if (req.isPlatformAdmin) {
    next();
    return;
  }
  return requireRole("owner", "admin")(req, res, next);
};
const defaults = {
  logoUrl: null,
  primaryColor: "#062B55",
  secondaryColor: "#1479C9",
  accentColor: "#39A8F0",
  backgroundColor: "#F3F5F7",
  foregroundColor: "#062B55",
  borderColor: "#D9DEE3",
  successColor: "#18864B",
  warningColor: "#C98200",
  errorColor: "#C93C3C",
  infoColor: "#1479C9",
};
const parse = (s: string) => { try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; } };
const contrast = (a: string, b: string) => {
  const lum = (hex: string) => {
    const c = hex.replace("#", "").match(/.{2}/g)?.map(x => parseInt(x, 16) / 255) ?? [0, 0, 0];
    const weights = [0.2126, 0.7152, 0.0722];
    return c.reduce((sum, x, index) => sum + (x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4) * weights[index], 0);
  };
  const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
};
const validateContrast = (data: Record<string, unknown>) => {
  const pairs: [string, string, string][] = [
    ["primaryColor", "primaryTextColor", "primary action text/background"],
    ["linkColor", "backgroundColor", "links/page background"],
    ["linkColor", "cardColor", "links/card surface"],
    ["successColor", "backgroundColor", "success status/page surface"],
    ["warningColor", "backgroundColor", "warning status/page surface"],
    ["errorColor", "backgroundColor", "error status/page surface"],
    ["infoColor", "backgroundColor", "info status/page surface"],
    ["focusColor", "backgroundColor", "focus ring/page surface"],
    ["focusColor", "cardColor", "focus ring/card surface"],
    ["foregroundColor", "backgroundColor", "important text/page surface"],
    ["foregroundColor", "cardColor", "important text/card surface"],
  ];
  return pairs.flatMap(([fgKey, bgKey, label]) => {
    const fg = String(data[fgKey] ?? (fgKey === "primaryTextColor" ? "#ffffff" : defaults.foregroundColor));
    const bg = String(data[bgKey] ?? (bgKey === "cardColor" ? "#ffffff" : defaults.backgroundColor));
    if (!/^#[0-9a-f]{6}$/i.test(fg) || !/^#[0-9a-f]{6}$/i.test(bg)) return [`${label}: provide valid 6-digit hex colors (${fgKey}, ${bgKey})`];
    return contrast(fg, bg) < 4.5 ? [`${label}: contrast is ${contrast(fg, bg).toFixed(2)}:1; use a darker ${fgKey} or lighter ${bgKey} (minimum 4.5:1)`] : [];
  });
};
const context = async (req: TenantRequest) => {
  const memberships = req.isPlatformAdmin
    ? await db.select({
        id: tenantsTable.id,
        name: tenantsTable.name,
        slug: tenantsTable.slug,
        status: tenantsTable.status,
        customerBrandingEnabled: tenantsTable.customerBrandingEnabled,
        role: sql<string>`'platform_admin'`,
      })
        .from(tenantsTable)
        .where(eq(tenantsTable.status, "active"))
        .orderBy(tenantsTable.name)
    : await db.select({
        id: tenantsTable.id,
        name: tenantsTable.name,
        slug: tenantsTable.slug,
        status: tenantsTable.status,
        customerBrandingEnabled: tenantsTable.customerBrandingEnabled,
        role: membershipsTable.role,
      })
        .from(membershipsTable)
        .innerJoin(tenantsTable, eq(membershipsTable.tenantId, tenantsTable.id))
        .where(eq(membershipsTable.userId, req.localUserId!));
  const environments = await db.select().from(environmentsTable)
    .where(
      req.isPlatformAdmin
        ? eq(environmentsTable.tenantId, req.tenantId!)
        : and(
            eq(environmentsTable.tenantId, req.tenantId!),
            sql`exists (
              select 1 from tenant_environment_access access
              where access.tenant_id = ${req.tenantId!}
                and access.environment_id = ${environmentsTable.id}
                and access.user_id = ${req.localUserId!}
            )`,
          ),
    )
    .orderBy(environmentsTable.name);
  const environmentResources = environments.length
    ? await db.select().from(environmentResourcesTable)
      .where(inArray(environmentResourcesTable.environmentId, environments.map((environment) => environment.id)))
    : [];
  const environmentHealthChecks = environments.length
    ? await db.select().from(environmentHealthChecksTable)
      .where(inArray(environmentHealthChecksTable.environmentId, environments.map((environment) => environment.id)))
    : [];
  const environmentsWithReadiness = environments.map((environment) => ({
    ...environment,
    executionContextReady: !environment.isolationEnforced || (
      isIsolatedEnvironmentReady(environmentResources.filter((resource) => resource.environmentId === environment.id)) &&
      isRuntimeSigningBoundaryReady(environmentResources.filter((resource) => resource.environmentId === environment.id)) &&
      isRecentHealthyCheck(environmentHealthChecks
        .filter((health) => health.environmentId === environment.id)
        .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())[0])
    ),
  }));
  const activeEnvironment = environmentsWithReadiness.find(x => x.id === req.environmentId) ?? environmentsWithReadiness[0];
  const activeTenant = memberships.find(x => x.id === req.tenantId);
  const businessTypes = await getTenantBusinessTypes(req.tenantId!);
  return {
    activeTenant: activeTenant ? { ...activeTenant, businessTypes } : undefined,
    memberships,
    activeEnvironment,
    environments: environmentsWithReadiness,
    environmentLabel: req.environmentLabel ?? process.env.APP_ENV ?? "development",
    isPlatformAdmin: Boolean(req.isPlatformAdmin),
  };
};

router.get("/tenant/context", async (req: TenantRequest, res) => res.json(await context(req)));
router.post("/tenant/context", async (req: TenantRequest, res) => {
  const parsed = SwitchTenantBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid tenant" }); return; }
  if (!req.isPlatformAdmin) {
    const [membership] = await db
      .select()
      .from(membershipsTable)
      .where(and(eq(membershipsTable.userId, req.localUserId!), eq(membershipsTable.tenantId, parsed.data.tenantId)));
    if (!membership) { res.status(403).json({ error: "Tenant membership required" }); return; }
    if (!membership.environmentAccessConfigured) {
      const legacyEnvironments = await db
        .select({ id: environmentsTable.id })
        .from(environmentsTable)
        .where(and(eq(environmentsTable.tenantId, parsed.data.tenantId), eq(environmentsTable.status, "active")));
      await db.insert(tenantEnvironmentAccessTable).values(
        legacyEnvironments.map((environment) => ({
          tenantId: parsed.data.tenantId,
          environmentId: environment.id,
          userId: req.localUserId!,
          grantedByUserId: req.localUserId!,
        })),
      ).onConflictDoNothing();
      await db
        .update(membershipsTable)
        .set({ environmentAccessConfigured: true })
        .where(and(eq(membershipsTable.tenantId, parsed.data.tenantId), eq(membershipsTable.userId, req.localUserId!)));
    }
  }
  const [tenant] = await db.select({ id: tenantsTable.id, status: tenantsTable.status })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, parsed.data.tenantId), eq(tenantsTable.status, "active")))
    .limit(1);
  if (!tenant) { res.status(404).json({ error: "Customer workspace not found" }); return; }
  const [environment] = await db.select().from(environmentsTable)
    .where(
      req.isPlatformAdmin
        ? eq(environmentsTable.tenantId, parsed.data.tenantId)
        : and(
            eq(environmentsTable.tenantId, parsed.data.tenantId),
            sql`exists (
              select 1 from tenant_environment_access access
              where access.tenant_id = ${parsed.data.tenantId}
                and access.environment_id = ${environmentsTable.id}
                and access.user_id = ${req.localUserId!}
            )`,
          ),
    )
    .orderBy(sql`case when ${environmentsTable.kind} = 'dtd' then 0 else 1 end`, environmentsTable.id)
    .limit(1);
  if (!environment) { res.status(409).json({ error: "Customer has no environment" }); return; }
  const tenantSwitchResources = await db.select().from(environmentResourcesTable)
    .where(eq(environmentResourcesTable.environmentId, environment.id));
  const [tenantSwitchHealth] = await db.select({
    status: environmentHealthChecksTable.status,
    checkedAt: environmentHealthChecksTable.checkedAt,
  }).from(environmentHealthChecksTable)
    .where(eq(environmentHealthChecksTable.environmentId, environment.id))
    .orderBy(desc(environmentHealthChecksTable.checkedAt)).limit(1);
  if (
    environment.isolationEnforced &&
    (!isIsolatedEnvironmentReady(tenantSwitchResources) || !isRuntimeSigningBoundaryReady(tenantSwitchResources) || !isRecentHealthyCheck(tenantSwitchHealth))
  ) {
    res.status(409).json({ error: "Customer environment is not ready" });
    return;
  }
  await db.update(userTenantContextTable).set({ activeTenantId: parsed.data.tenantId, activeEnvironmentId: environment.id, updatedAt: new Date() }).where(eq(userTenantContextTable.userId, req.localUserId!));
  req.tenantId = parsed.data.tenantId;
  req.environmentId = environment.id;
  res.json(await context(req));
});

const serializeFeature = (feature: Awaited<ReturnType<typeof getFeatureAvailability>>[number]) => {
  const { businessTypes: _businessTypes, ...publicFeature } = feature;
  return publicFeature;
};

const businessProfile = async (req: TenantRequest) => {
  const businessTypes = await getTenantBusinessTypes(req.tenantId!);
  return {
    businessTypes,
    features: (await getFeatureAvailability(req.tenantId!, businessTypes)).map(serializeFeature),
  };
};

router.get("/tenant/business-profile", async (req: TenantRequest, res) => {
  res.json(await businessProfile(req));
});

router.post(
  "/tenant/business-profile/preview",
  requireRole("owner", "admin"),
  async (req: TenantRequest, res) => {
    const parsed = UpdateTenantBusinessProfileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Select at least one business type", details: parsed.error.issues });
      return;
    }
    const currentBusinessTypes = await getTenantBusinessTypes(req.tenantId!);
    const nextBusinessTypes = normalizeBusinessTypes(parsed.data.businessTypes);
    if (!nextBusinessTypes) {
      res.status(400).json({ error: "Select at least one valid business type" });
      return;
    }
    const changes = featureChanges(currentBusinessTypes, nextBusinessTypes);
    res.json({
      currentBusinessTypes,
      nextBusinessTypes,
      addedFeatures: changes.addedFeatures.map(serializeFeature),
      removedFeatures: changes.removedFeatures.map(serializeFeature),
    });
  },
);

router.put(
  "/tenant/business-profile",
  requireRole("owner", "admin"),
  async (req: TenantRequest, res) => {
    const parsed = UpdateTenantBusinessProfileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Select at least one business type", details: parsed.error.issues });
      return;
    }
    const businessTypes = normalizeBusinessTypes(parsed.data.businessTypes);
    if (!businessTypes) {
      res.status(400).json({ error: "Select at least one valid business type" });
      return;
    }
    try {
      const previousBusinessTypes = await getTenantBusinessTypes(req.tenantId!);
      await replaceTenantBusinessTypes(req.tenantId!, businessTypes);
      await db.insert(platformAuditEventsTable).values({
        actorUserId: req.localUserId!,
        tenantId: req.tenantId!,
        action: "tenant_business_types_updated",
        details: JSON.stringify({ previousBusinessTypes, businessTypes }),
      });
      res.json(await businessProfile(req));
    } catch (error) {
      req.log?.error({ err: error, tenantId: req.tenantId, userId: req.localUserId }, "failed to update tenant business types");
      res.status(500).json({ error: "Unable to update workspace business types" });
    }
  },
);

router.get("/tenant/environments", async (req: TenantRequest, res) => {
  const environments = await db.select().from(environmentsTable)
    .where(
      req.isPlatformAdmin
        ? eq(environmentsTable.tenantId, req.tenantId!)
        : and(
            eq(environmentsTable.tenantId, req.tenantId!),
            sql`exists (
              select 1 from tenant_environment_access access
              where access.tenant_id = ${req.tenantId!}
                and access.environment_id = ${environmentsTable.id}
                and access.user_id = ${req.localUserId!}
            )`,
          ),
    )
    .orderBy(environmentsTable.name);
  const resourceRows = environments.length
    ? await db.select().from(environmentResourcesTable)
      .where(inArray(environmentResourcesTable.environmentId, environments.map((environment) => environment.id)))
    : [];
  const healthRows = environments.length
    ? await db.select().from(environmentHealthChecksTable)
      .where(inArray(environmentHealthChecksTable.environmentId, environments.map((environment) => environment.id)))
    : [];
  res.json(environments.map((environment) => ({
    ...environment,
    executionContextReady: !environment.isolationEnforced || (
      isIsolatedEnvironmentReady(resourceRows.filter((resource) => resource.environmentId === environment.id)) &&
      isRuntimeSigningBoundaryReady(resourceRows.filter((resource) => resource.environmentId === environment.id)) &&
      isRecentHealthyCheck(healthRows
        .filter((health) => health.environmentId === environment.id)
        .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())[0])
    ),
  })));
});
router.post("/tenant/environments", async (req: TenantRequest, res) => {
  const parsed = SwitchEnvironmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid environment" }); return; }
  const [environment] = await db.select().from(environmentsTable).where(and(
    eq(environmentsTable.id, parsed.data.environmentId),
    eq(environmentsTable.tenantId, req.tenantId!),
    req.isPlatformAdmin
      ? sql`true`
      : sql`exists (
          select 1 from tenant_environment_access access
          where access.tenant_id = ${req.tenantId!}
            and access.environment_id = ${environmentsTable.id}
            and access.user_id = ${req.localUserId!}
        )`,
  ));
  if (!environment) { res.status(403).json({ error: "Environment access required" }); return; }
  const resources = await db.select().from(environmentResourcesTable)
    .where(eq(environmentResourcesTable.environmentId, environment.id));
  const [healthCheck] = await db.select({
    status: environmentHealthChecksTable.status,
    checkedAt: environmentHealthChecksTable.checkedAt,
  }).from(environmentHealthChecksTable)
    .where(eq(environmentHealthChecksTable.environmentId, environment.id))
    .orderBy(desc(environmentHealthChecksTable.checkedAt))
    .limit(1);
  if (
    environment.isolationEnforced &&
    (!isIsolatedEnvironmentReady(resources) || !isRuntimeSigningBoundaryReady(resources) || !isRecentHealthyCheck(healthCheck))
  ) {
    res.status(409).json({
      error: "Environment is not ready",
      details: "Switching environments requires all isolated runtime resources to be ready",
      environmentId: environment.id,
    });
    return;
  }
  await db.update(userTenantContextTable).set({ activeEnvironmentId: environment.id, updatedAt: new Date() })
    .where(eq(userTenantContextTable.userId, req.localUserId!));
  req.environmentId = environment.id;
  res.json(await context(req));
});

router.get("/tenant/releases", releaseAdmin, async (req: TenantRequest, res) => {
  const assignments = await db.select({
    assignment: environmentReleaseAssignmentsTable,
    release: platformReleasesTable,
    environment: environmentsTable,
  })
    .from(environmentReleaseAssignmentsTable)
    .innerJoin(platformReleasesTable, eq(environmentReleaseAssignmentsTable.releaseId, platformReleasesTable.id))
    .innerJoin(environmentsTable, eq(environmentReleaseAssignmentsTable.environmentId, environmentsTable.id))
    .where(and(
      eq(environmentsTable.tenantId, req.tenantId!),
      req.isPlatformAdmin
        ? sql`true`
        : sql`exists (
          select 1 from tenant_environment_access access
          where access.tenant_id = ${req.tenantId!}
            and access.environment_id = ${environmentsTable.id}
            and access.user_id = ${req.localUserId!}
        )`,
    ))
    .orderBy(sql`${environmentReleaseAssignmentsTable.assignedAt} desc`);
  const events = assignments.length
    ? await db.select().from(releaseAssignmentEventsTable)
      .where(inArray(releaseAssignmentEventsTable.assignmentId, assignments.map(({ assignment }) => assignment.id)))
      .orderBy(releaseAssignmentEventsTable.occurredAt)
    : [];
  const actors = await releaseActorNames(events);
  res.json(assignments.map(({ assignment, release, environment }) => ({
    ...assignment,
    events: events
      .filter((event) => event.assignmentId === assignment.id)
      .map((event) => serializeReleaseEvent(event, actors)),
    release: {
      ...release,
      appPayload: parse(release.appPayload),
      configPayload: parse(release.configPayload),
    },
    environment: {
      id: environment.id,
      name: environment.name,
      slug: environment.slug,
      kind: environment.kind,
    },
  })));
});

router.post("/tenant/releases/:assignmentId/validate", releaseAdmin, async (req: TenantRequest, res) => {
  const assignmentId = Number(req.params.assignmentId);
  if (!Number.isInteger(assignmentId) || assignmentId < 1) {
    res.status(400).json({ error: "Invalid release assignment" });
    return;
  }
  const row = await releaseAssignment(assignmentId, req.tenantId!, req.localUserId!, Boolean(req.isPlatformAdmin));
  if (!row) {
    res.status(404).json({ error: "Release assignment not found" });
    return;
  }
  if (row.release.releaseType !== "feature" || row.environment.kind !== "dtd") {
    res.status(409).json({ error: "Only feature releases assigned to Customer DTD can be validated" });
    return;
  }
  if (row.assignment.validationStatus === "validated") {
    res.json(await assignmentWithEvents(row.assignment));
    return;
  }
  if (row.assignment.approvalStatus === "rejected") {
    res.status(409).json({ error: "Rejected releases cannot be validated" });
    return;
  }
  if (row.assignment.deploymentStatus !== "deployed") {
    res.status(409).json({ error: "Feature releases must be deployed to Customer DTD before validation" });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    const [changed] = await tx.update(environmentReleaseAssignmentsTable).set({
      validationStatus: "validated", validatedByUserId: req.localUserId!, validatedAt: new Date(), updatedAt: new Date(),
    }).where(and(
      eq(environmentReleaseAssignmentsTable.id, assignmentId),
      eq(environmentReleaseAssignmentsTable.validationStatus, "pending"),
    )).returning();
    if (!changed) {
      const [current] = await tx.select().from(environmentReleaseAssignmentsTable).where(eq(environmentReleaseAssignmentsTable.id, assignmentId));
      return current ?? row.assignment;
    }
    await tx.insert(platformAuditEventsTable).values({
      actorUserId: req.localUserId!, tenantId: req.tenantId!, action: "platform_release_validated",
      details: JSON.stringify({ releaseId: row.release.id, assignmentId }),
    });
    await writeReleaseTransition(tx, req.localUserId!, row.release.id, assignmentId, "validated", row.assignment.validationStatus, changed.validationStatus);
    return changed;
  });
  res.json(await assignmentWithEvents(updated));
});

router.post("/tenant/releases/:assignmentId/approve", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const assignmentId = Number(req.params.assignmentId);
  if (!Number.isInteger(assignmentId) || assignmentId < 1) {
    res.status(400).json({ error: "Invalid release assignment" });
    return;
  }
  const row = await releaseAssignment(assignmentId, req.tenantId!, req.localUserId!, false);
  if (!row) {
    res.status(404).json({ error: "Release assignment not found" });
    return;
  }
  if (row.release.releaseType !== "feature" || row.environment.kind !== "dtd") {
    res.status(409).json({ error: "Only feature releases in Customer DTD require customer approval" });
    return;
  }
  if (row.assignment.validationStatus !== "validated") {
    res.status(409).json({ error: "Customer DTD validation is required before approval" });
    return;
  }
  if (row.assignment.approvalStatus === "approved") {
    res.json(await assignmentWithEvents(row.assignment));
    return;
  }
  if (row.assignment.approvalStatus === "rejected") {
    res.status(409).json({ error: "Rejected releases cannot be approved without a new release assignment" });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    const [changed] = await tx.update(environmentReleaseAssignmentsTable).set({
      approvalStatus: "approved", approvedByUserId: req.localUserId!, approvedAt: new Date(), updatedAt: new Date(),
    }).where(and(
      eq(environmentReleaseAssignmentsTable.id, assignmentId),
      eq(environmentReleaseAssignmentsTable.approvalStatus, "pending"),
      eq(environmentReleaseAssignmentsTable.validationStatus, "validated"),
    )).returning();
    if (!changed) {
      const [current] = await tx.select().from(environmentReleaseAssignmentsTable).where(eq(environmentReleaseAssignmentsTable.id, assignmentId));
      return current ?? row.assignment;
    }
    await tx.insert(platformAuditEventsTable).values({
      actorUserId: req.localUserId!, tenantId: req.tenantId!, action: "platform_release_approved",
      details: JSON.stringify({ releaseId: row.release.id, assignmentId }),
    });
    await writeReleaseTransition(tx, req.localUserId!, row.release.id, assignmentId, "approved", row.assignment.approvalStatus, changed.approvalStatus);
    return changed;
  });
  res.json(await assignmentWithEvents(updated));
});

router.post("/tenant/releases/:assignmentId/reject", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const parsed = RejectTenantReleaseBody.safeParse(req.body);
  if (!Number.isInteger(assignmentId) || assignmentId < 1 || !parsed.success) {
    res.status(400).json({ error: "A rejection reason is required" });
    return;
  }
  const row = await releaseAssignment(assignmentId, req.tenantId!, req.localUserId!, false);
  if (!row) {
    res.status(404).json({ error: "Release assignment not found" });
    return;
  }
  if (row.release.releaseType !== "feature" || row.environment.kind !== "dtd") {
    res.status(409).json({ error: "Only feature releases in Customer DTD require customer approval" });
    return;
  }
  if (row.assignment.validationStatus !== "validated") {
    res.status(409).json({ error: "Customer DTD validation is required before rejection" });
    return;
  }
  if (row.assignment.approvalStatus === "rejected") {
    res.json(await assignmentWithEvents(row.assignment));
    return;
  }
  if (row.assignment.approvalStatus === "approved") {
    res.status(409).json({ error: "Approved releases cannot be rejected" });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    const [changed] = await tx.update(environmentReleaseAssignmentsTable).set({
      status: "rejected", approvalStatus: "rejected", rejectionReason: parsed.data.reason,
      rejectedByUserId: req.localUserId!, rejectedAt: new Date(), updatedAt: new Date(),
    }).where(and(
      eq(environmentReleaseAssignmentsTable.id, assignmentId),
      eq(environmentReleaseAssignmentsTable.approvalStatus, "pending"),
      eq(environmentReleaseAssignmentsTable.validationStatus, "validated"),
    )).returning();
    if (!changed) {
      const [current] = await tx.select().from(environmentReleaseAssignmentsTable).where(eq(environmentReleaseAssignmentsTable.id, assignmentId));
      return current ?? row.assignment;
    }
    await tx.insert(platformAuditEventsTable).values({
      actorUserId: req.localUserId!, tenantId: req.tenantId!, action: "platform_release_rejected",
      details: JSON.stringify({ releaseId: row.release.id, assignmentId, reason: parsed.data.reason }),
    });
    await writeReleaseTransition(tx, req.localUserId!, row.release.id, assignmentId, "rejected", row.assignment.approvalStatus, changed.approvalStatus, { reason: parsed.data.reason });
    return changed;
  });
  res.json(await assignmentWithEvents(updated));
});
async function requireCustomerBranding(
  req: TenantRequest,
  res: Response,
  next: NextFunction,
) {
  const [tenant] = await db
    .select({ enabled: tenantsTable.customerBrandingEnabled })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, req.tenantId!))
    .limit(1);
  if (!tenant?.enabled) {
    res.status(403).json({ error: "Customer Branding is not enabled for this workspace" });
    return;
  }
  next();
}

router.get("/tenant/branding/published", requireCustomerBranding, async (req: TenantRequest, res) => {
  const published = await db.select().from(tenantBrandingVersionsTable).where(and(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!), eq(tenantBrandingVersionsTable.environmentId, req.environmentId!))).orderBy(desc(tenantBrandingVersionsTable.version));
  res.json({ published: published.map(v => ({ ...v, data: parse(v.data) })) });
});
router.get("/tenant/branding", requireCustomerBranding, requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const [draft] = await db.select().from(tenantBrandingDraftsTable).where(and(eq(tenantBrandingDraftsTable.tenantId, req.tenantId!), eq(tenantBrandingDraftsTable.environmentId, req.environmentId!)));
  const published = await db.select().from(tenantBrandingVersionsTable).where(and(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!), eq(tenantBrandingVersionsTable.environmentId, req.environmentId!))).orderBy(desc(tenantBrandingVersionsTable.version));
  res.json({ draft: draft ? parse(draft.data) : defaults, published: published.map(v => ({ ...v, data: parse(v.data) })) });
});
router.put("/tenant/branding", requireCustomerBranding, requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const parsed = SaveBrandingDraftBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid branding", details: parsed.error.issues }); return; }
  await db.insert(tenantBrandingDraftsTable).values({ tenantId: req.tenantId!, environmentId: req.environmentId!, data: JSON.stringify(parsed.data), updatedByUserId: req.localUserId! })
    .onConflictDoUpdate({ target: [tenantBrandingDraftsTable.tenantId, tenantBrandingDraftsTable.environmentId], set: { data: JSON.stringify(parsed.data), updatedByUserId: req.localUserId!, updatedAt: new Date() } });
  const published = await db.select().from(tenantBrandingVersionsTable).where(and(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!), eq(tenantBrandingVersionsTable.environmentId, req.environmentId!))).orderBy(desc(tenantBrandingVersionsTable.version));
  res.json({ draft: parsed.data, published: published.map(v => ({ ...v, data: parse(v.data) })) });
});
router.post("/tenant/branding/publish", requireCustomerBranding, requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const [draft] = await db.select().from(tenantBrandingDraftsTable).where(and(eq(tenantBrandingDraftsTable.tenantId, req.tenantId!), eq(tenantBrandingDraftsTable.environmentId, req.environmentId!)));
  const data = draft ? parse(draft.data) : defaults;
  const failures = validateContrast(data);
  if (failures.length) { res.status(422).json({ error: "Branding fails WCAG AA contrast validation", failures }); return; }
  const [version] = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${req.tenantId!})`);
     const [{ max }] = await tx.select({ max: tenantBrandingVersionsTable.version }).from(tenantBrandingVersionsTable).where(and(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!), eq(tenantBrandingVersionsTable.environmentId, req.environmentId!)));
     return tx.insert(tenantBrandingVersionsTable).values({ tenantId: req.tenantId!, environmentId: req.environmentId!, version: Number(max ?? 0) + 1, data: JSON.stringify(data), publishedByUserId: req.localUserId! }).returning();
  });
  res.json({ ...version, data });
});
router.post("/tenant/branding/rollback/:version", requireCustomerBranding, requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const parsed = RollbackBrandingParams.safeParse(req.params); if (!parsed.success) { res.status(400).json({ error: "Invalid version" }); return; }
  const [version] = await db.select().from(tenantBrandingVersionsTable).where(and(
    eq(tenantBrandingVersionsTable.tenantId, req.tenantId!),
    eq(tenantBrandingVersionsTable.environmentId, req.environmentId!),
    eq(tenantBrandingVersionsTable.version, parsed.data.version),
  ));
  if (!version) { res.status(404).json({ error: "Version not found" }); return; }
  await db.insert(tenantBrandingDraftsTable).values({ tenantId: req.tenantId!, environmentId: req.environmentId!, data: version.data, updatedByUserId: req.localUserId! }).onConflictDoUpdate({ target: [tenantBrandingDraftsTable.tenantId, tenantBrandingDraftsTable.environmentId], set: { data: version.data, updatedByUserId: req.localUserId!, updatedAt: new Date() } });
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${req.tenantId!})`);
     const [{ max }] = await tx.select({ max: tenantBrandingVersionsTable.version }).from(tenantBrandingVersionsTable).where(and(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!), eq(tenantBrandingVersionsTable.environmentId, req.environmentId!)));
     await tx.insert(tenantBrandingVersionsTable).values({ tenantId: req.tenantId!, environmentId: req.environmentId!, version: Number(max ?? 0) + 1, data: version.data, publishedByUserId: req.localUserId! });
  });
  const history = await db.select().from(tenantBrandingVersionsTable).where(and(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!), eq(tenantBrandingVersionsTable.environmentId, req.environmentId!))).orderBy(desc(tenantBrandingVersionsTable.version));
  res.json({ draft: parse(version.data), published: history.map(v => ({ ...v, data: parse(v.data) })) });
});
router.post("/tenant/branding/reset", requireCustomerBranding, requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  await db.insert(tenantBrandingDraftsTable).values({ tenantId: req.tenantId!, environmentId: req.environmentId!, data: JSON.stringify(defaults), updatedByUserId: req.localUserId! }).onConflictDoUpdate({ target: [tenantBrandingDraftsTable.tenantId, tenantBrandingDraftsTable.environmentId], set: { data: JSON.stringify(defaults), updatedByUserId: req.localUserId!, updatedAt: new Date() } });
  const published = await db.select().from(tenantBrandingVersionsTable).where(and(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!), eq(tenantBrandingVersionsTable.environmentId, req.environmentId!))).orderBy(desc(tenantBrandingVersionsTable.version));
  res.json({ draft: defaults, published: published.map(v => ({ ...v, data: parse(v.data) })) });
});
export default router;