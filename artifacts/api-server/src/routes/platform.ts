import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  environmentsTable,
  environmentReleaseAssignmentsTable,
  membershipsTable,
  platformReleasesTable,
  releaseAssignmentEventsTable,
  platformAuditEventsTable,
  tenantBusinessTypesTable,
  tenantEnvironmentAccessTable,
  tenantsTable,
  tenantInvitationsTable,
  usersTable,
  type TenantBusinessType,
  environmentResourcesTable,
  environmentSnapshotsTable,
  environmentHealthChecksTable,
  environmentReleaseControlsTable,
} from "@workspace/db";
import {
  CreatePlatformCustomerInvitationBody,
  CreatePlatformCustomerBody,
  UpdatePlatformCustomerMemberBody,
  UpdatePlatformCustomerBody,
  CreatePlatformReleaseBody,
  AssignPlatformReleaseBody,
  DeployPlatformReleaseBody,
} from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requirePlatformAdmin } from "../middlewares/platformAdmin";
import {
  ActiveTenantInvitationError,
  createTenantInvitation,
  InvalidTenantInvitationError,
  normalizeInvitationEmail,
  serializeInvitation,
} from "./tenant-admin";
import { createCustomerWorkspace } from "../lib/customer-onboarding";
import { DEFAULT_TENANT_BUSINESS_TYPES, getTenantBusinessTypes } from "../lib/tenant-business-profile";
import { isIsolatedEnvironmentReady, isRecentHealthyCheck } from "../lib/provisioning";
import {
  checkInvitationRateLimit,
  deliverInvitationEmail,
  type InvitationDeliveryOutcome,
} from "../lib/invitation-email";

const router: IRouter = Router();
const APP_ENV = process.env.APP_ENV ?? "development";

async function writeAudit(
  req: TenantRequest,
  action: string,
  tenantId: number | null,
  details: Record<string, unknown>,
) {
  await db.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId,
    action,
    details: JSON.stringify(details),
  });
}

const parsePayload = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

// Orval emits these complete nested schemas inline on the generated request
// schema. Reuse them for persisted rows instead of duplicating constraints.
const applicationMetadataSchema = CreatePlatformReleaseBody.shape.appPayload;
const configurationMetadataSchema = CreatePlatformReleaseBody.shape.configPayload;
const applicationMetadataKeys = new Set(Object.keys(applicationMetadataSchema.shape));
const configurationMetadataKeys = new Set(Object.keys(configurationMetadataSchema.shape));
const isExactMetadata = (value: unknown, keys: Set<string>) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => keys.has(key));
};
const isPersistedMetadata = (
  value: unknown,
  schema: { safeParse: (value: unknown) => { success: boolean } },
  keys: Set<string>,
) => isExactMetadata(value, keys) && schema.safeParse(value).success;
const validReleasePayloads = (release: typeof platformReleasesTable.$inferSelect) => {
  try {
    return isPersistedMetadata(JSON.parse(release.appPayload), applicationMetadataSchema, applicationMetadataKeys)
      && isPersistedMetadata(JSON.parse(release.configPayload), configurationMetadataSchema, configurationMetadataKeys);
  } catch {
    return false;
  }
};
const parseStoredPayload = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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

const serializeEvent = (
  event: typeof releaseAssignmentEventsTable.$inferSelect,
  actors: ReleaseActorNames = new Map(),
) => ({
  ...event,
  actorDisplayName: event.actorUserId === null
    ? "Legacy actor"
    : actors.get(event.actorUserId) ?? "Unavailable user",
  details: (() => { try { return JSON.parse(event.details) as Record<string, unknown>; } catch { return {}; } })(),
});

const serializeRelease = (
  release: typeof platformReleasesTable.$inferSelect,
  assignments: (typeof environmentReleaseAssignmentsTable.$inferSelect)[],
  events: (typeof releaseAssignmentEventsTable.$inferSelect)[],
  actors: ReleaseActorNames = new Map(),
) => ({
  ...release,
  appPayload: parseStoredPayload(release.appPayload),
  configPayload: parseStoredPayload(release.configPayload),
  assignments: assignments.map((assignment) => ({
    ...assignment,
    events: events.filter((event) => event.assignmentId === assignment.id).map((event) => serializeEvent(event, actors)),
  })),
  events: events.filter((event) => event.assignmentId === null).map((event) => serializeEvent(event, actors)),
});

async function writeAuditIn(tx: any, req: TenantRequest, action: string, tenantId: number | null, details: Record<string, unknown>) {
  await tx.insert(platformAuditEventsTable).values({
    actorUserId: req.localUserId!,
    tenantId,
    action,
    details: JSON.stringify(details),
  });
}

async function writeReleaseEventIn(
  tx: any,
  actorUserId: number,
  releaseId: number,
  assignmentId: number | null,
  action: string,
  fromStatus: string | null,
  toStatus: string | null,
  details: Record<string, unknown> = {},
) {
  await tx.insert(releaseAssignmentEventsTable).values({
    actorUserId, releaseId, assignmentId, action, fromStatus, toStatus, details: JSON.stringify(details),
  });
}

async function serializeCustomer(tenant: typeof tenantsTable.$inferSelect) {
  const [{ memberCount }] = await db
    .select({ memberCount: sql<number>`count(*)::int` })
    .from(membershipsTable)
    .where(eq(membershipsTable.tenantId, tenant.id));
  const [{ invitationCount }] = await db
    .select({ invitationCount: sql<number>`count(*)::int` })
    .from(tenantInvitationsTable)
    .where(
      and(
        eq(tenantInvitationsTable.tenantId, tenant.id),
        sql`${tenantInvitationsTable.acceptedAt} is null`,
        sql`${tenantInvitationsTable.revokedAt} is null`,
        sql`${tenantInvitationsTable.expiresAt} > now()`,
      ),
    );
  const environments = await db
    .select({
      id: environmentsTable.id,
      name: environmentsTable.name,
      slug: environmentsTable.slug,
      kind: environmentsTable.kind,
      status: environmentsTable.status,
    })
    .from(environmentsTable)
    .where(eq(environmentsTable.tenantId, tenant.id))
    .orderBy(environmentsTable.id);
  const businessTypes = await getTenantBusinessTypes(tenant.id);
  return {
    ...tenant,
    businessTypes,
    memberCount: Number(memberCount),
    pendingInvitationCount: Number(invitationCount),
    customerBrandingEnabled: tenant.customerBrandingEnabled,
    environments,
  };
}

async function getCustomer(tenantId: number) {
  const [tenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  return tenant;
}

async function serializeMember(tenantId: number, userId: number) {
  const [member] = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      displayName: usersTable.displayName,
      role: membershipsTable.role,
      joinedAt: membershipsTable.createdAt,
    })
    .from(membershipsTable)
    .innerJoin(usersTable, eq(membershipsTable.userId, usersTable.id))
    .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.userId, userId)))
    .limit(1);
  if (!member) return null;
  const access = await db
    .select({
      environmentId: tenantEnvironmentAccessTable.environmentId,
      environmentName: environmentsTable.name,
    })
    .from(tenantEnvironmentAccessTable)
    .innerJoin(environmentsTable, eq(tenantEnvironmentAccessTable.environmentId, environmentsTable.id))
    .where(
      and(
        eq(tenantEnvironmentAccessTable.tenantId, tenantId),
        eq(tenantEnvironmentAccessTable.userId, userId),
      ),
    )
    .orderBy(environmentsTable.name);
  return {
    ...member,
    environmentIds: access.map((environment) => environment.environmentId),
    environments: access.map(({ environmentId, environmentName }) => ({
      id: environmentId,
      name: environmentName,
    })),
  };
}

async function serializeCustomerDetails(tenant: typeof tenantsTable.$inferSelect) {
  const customer = await serializeCustomer(tenant);
  const members = await db
    .select({ userId: membershipsTable.userId })
    .from(membershipsTable)
    .where(eq(membershipsTable.tenantId, tenant.id))
    .orderBy(membershipsTable.userId);
  const invitations = await db
    .select()
    .from(tenantInvitationsTable)
    .where(eq(tenantInvitationsTable.tenantId, tenant.id))
    .orderBy(sql`${tenantInvitationsTable.createdAt} desc`);
  return {
    customer,
    members: (await Promise.all(members.map(({ userId }) => serializeMember(tenant.id, userId)))).filter(Boolean),
    invitations: invitations.map(serializeInvitation),
  };
}

function parseAuditDetails(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const isSafeUserId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

router.post("/platform/bootstrap", async (req: TenantRequest, res) => {
  if (APP_ENV !== "production") {
    res.status(403).json({ error: "Production bootstrap is only available in production" });
    return;
  }
  const configuredToken = process.env.PLATFORM_BOOTSTRAP_TOKEN;
  const suppliedToken = req.header("x-platform-bootstrap-token");
  if (!configuredToken || !suppliedToken) {
    res.status(503).json({ error: "Platform bootstrap is not configured" });
    return;
  }
  const expected = createHash("sha256").update(configuredToken).digest();
  const supplied = createHash("sha256").update(suppliedToken).digest();
  if (!timingSafeEqual(expected, supplied)) {
    res.status(403).json({ error: "Invalid platform bootstrap token" });
    return;
  }
  const [existingAdmin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.isPlatformAdmin, true))
    .limit(1);
  if (existingAdmin) {
    res.status(409).json({ error: "A platform administrator already exists" });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ isPlatformAdmin: true, updatedAt: new Date() })
    .where(eq(usersTable.id, req.localUserId!))
    .returning({ id: usersTable.id });
  if (!updated) {
    res.status(401).json({ error: "Authenticated user not found" });
    return;
  }
  await writeAudit(req, "platform_bootstrapped", null, { userId: updated.id });
  res.status(201).json({ bootstrapped: true });
});

router.use("/platform", requirePlatformAdmin);

router.get("/platform/releases", async (_req: TenantRequest, res) => {
  const releases = await db.select().from(platformReleasesTable).orderBy(sql`${platformReleasesTable.createdAt} desc`);
  const assignments = await db.select().from(environmentReleaseAssignmentsTable);
  const events = await db.select().from(releaseAssignmentEventsTable).orderBy(releaseAssignmentEventsTable.occurredAt);
  const actors = await releaseActorNames(events);
  res.json(releases.map((release) => serializeRelease(
    release,
    assignments.filter((assignment) => assignment.releaseId === release.id),
    events.filter((event) => event.releaseId === release.id),
    actors,
  )));
});

router.post("/platform/releases", async (req: TenantRequest, res) => {
  const parsed = CreatePlatformReleaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid release metadata", details: parsed.error.issues });
    return;
  }
  if (parsed.data.releaseType === "feature" && parsed.data.mandatory) {
    res.status(400).json({ error: "Only security and platform releases may be mandatory" });
    return;
  }
  const appPayload = parsePayload(parsed.data.appPayload);
  const configPayload = parsePayload(parsed.data.configPayload);
  const rawAppPayload = parsePayload(req.body?.appPayload);
  const rawConfigPayload = parsePayload(req.body?.configPayload);
  if (
    !isExactMetadata(appPayload, applicationMetadataKeys)
    || !isExactMetadata(configPayload, configurationMetadataKeys)
    || !isExactMetadata(rawAppPayload, applicationMetadataKeys)
    || !isExactMetadata(rawConfigPayload, configurationMetadataKeys)
  ) {
    res.status(400).json({ error: "Application and configuration payloads must use the allowlisted artifact metadata contract" });
    return;
  }
  const release = await db.transaction(async (tx) => {
    const [created] = await tx.insert(platformReleasesTable).values({
      releaseType: parsed.data.releaseType,
      version: parsed.data.version,
      status: "released",
      notes: parsed.data.notes,
      appPayload: JSON.stringify(appPayload),
      configPayload: JSON.stringify(configPayload),
      mandatory: parsed.data.mandatory,
      createdByUserId: req.localUserId!,
    }).onConflictDoNothing({ target: [platformReleasesTable.releaseType, platformReleasesTable.version] }).returning();
    if (!created) return null;
    await writeAuditIn(tx, req, "platform_release_created", null, {
      releaseId: created.id, releaseType: created.releaseType, version: created.version, mandatory: created.mandatory,
    });
    await writeReleaseEventIn(tx, req.localUserId!, created.id, null, "created", null, created.status, {
      releaseType: created.releaseType, version: created.version,
    });
    return created;
  });
  if (!release) {
    res.status(409).json({ error: "A release with this type and version already exists" });
    return;
  }
  const events = await db.select().from(releaseAssignmentEventsTable).where(eq(releaseAssignmentEventsTable.releaseId, release.id));
  const actors = await releaseActorNames(events);
  res.status(201).json(serializeRelease(release, [], events, actors));
});

router.post("/platform/releases/:releaseId/assign", async (req: TenantRequest, res) => {
  const releaseId = Number(req.params.releaseId);
  const parsed = AssignPlatformReleaseBody.safeParse(req.body);
  if (!Number.isInteger(releaseId) || releaseId < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid release assignment" });
    return;
  }
  const [release] = await db.select().from(platformReleasesTable).where(eq(platformReleasesTable.id, releaseId)).limit(1);
  if (!release) {
    res.status(404).json({ error: "Release not found" });
    return;
  }
  if (release.status !== "released" || !validReleasePayloads(release)) {
    res.status(409).json({ error: "This legacy or unreleasable release cannot be assigned" });
    return;
  }
  const [environment] = await db.select().from(environmentsTable).where(and(
    eq(environmentsTable.id, parsed.data.environmentId),
    eq(environmentsTable.status, "active"),
  )).limit(1);
  if (!environment) {
    res.status(404).json({ error: "Active environment not found" });
    return;
  }
  if (environment.kind === "production" && (release.releaseType === "security" || release.releaseType === "platform") && !release.mandatory) {
    res.status(409).json({ error: "Security and platform releases must be marked mandatory for direct production assignment" });
    return;
  }
  const sourceDtd = environment.kind === "production" && release.releaseType === "feature"
    ? (await db.select({
        id: environmentReleaseAssignmentsTable.id,
        approvedByUserId: environmentReleaseAssignmentsTable.approvedByUserId,
        approvedAt: environmentReleaseAssignmentsTable.approvedAt,
        validatedByUserId: environmentReleaseAssignmentsTable.validatedByUserId,
        validatedAt: environmentReleaseAssignmentsTable.validatedAt,
      }).from(environmentReleaseAssignmentsTable)
        .innerJoin(environmentsTable, eq(environmentReleaseAssignmentsTable.environmentId, environmentsTable.id))
        .where(and(
          eq(environmentReleaseAssignmentsTable.releaseId, release.id),
          eq(environmentsTable.tenantId, environment.tenantId),
          eq(environmentsTable.kind, "dtd"),
          eq(environmentReleaseAssignmentsTable.approvalStatus, "approved"),
          eq(environmentReleaseAssignmentsTable.validationStatus, "validated"),
          eq(environmentReleaseAssignmentsTable.deploymentStatus, "deployed"),
        )).limit(1))[0]
    : undefined;
  if (environment.kind === "production" && release.releaseType === "feature" && !sourceDtd) {
    res.status(409).json({ error: "Feature releases require approved Customer DTD validation before production assignment" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(environmentReleaseAssignmentsTable).values({
      environmentId: environment.id,
      releaseId: release.id,
      sourceDtdAssignmentId: sourceDtd?.id,
      status: "assigned",
      assignedByUserId: req.localUserId!,
      approvalStatus: sourceDtd ? "approved" : release.releaseType === "feature" ? "pending" : release.mandatory ? "mandatory" : "not_required",
      approvedByUserId: sourceDtd?.approvedByUserId,
      approvedAt: sourceDtd?.approvedAt,
      validationStatus: sourceDtd ? "validated" : release.releaseType === "feature" ? "pending" : "not_required",
      validatedByUserId: sourceDtd?.validatedByUserId,
      validatedAt: sourceDtd?.validatedAt,
    }).onConflictDoNothing({
      target: [environmentReleaseAssignmentsTable.environmentId, environmentReleaseAssignmentsTable.releaseId],
    }).returning();
    if (!created) {
      const [current] = await tx.select().from(environmentReleaseAssignmentsTable).where(and(
        eq(environmentReleaseAssignmentsTable.environmentId, environment.id),
        eq(environmentReleaseAssignmentsTable.releaseId, release.id),
      )).limit(1);
      return { assignment: current, created: false };
    }
    await writeAuditIn(tx, req, "platform_release_assigned", environment.tenantId, {
      releaseId: release.id, assignmentId: created.id, environmentId: environment.id, sourceDtdAssignmentId: sourceDtd?.id,
    });
    await writeReleaseEventIn(tx, req.localUserId!, release.id, created.id, "assigned", null, created.status, {
      environmentId: environment.id, sourceDtdAssignmentId: sourceDtd?.id,
    });
    return { assignment: created, created: true };
  });
  const events = await db.select().from(releaseAssignmentEventsTable).where(eq(releaseAssignmentEventsTable.assignmentId, result.assignment!.id));
  const actors = await releaseActorNames(events);
  res.status(result.created ? 201 : 200).json({
    ...result.assignment,
    events: events.map((event) => serializeEvent(event, actors)),
  });
});

router.post("/platform/releases/:releaseId/deploy", async (req: TenantRequest, res) => {
  const releaseId = Number(req.params.releaseId);
  const parsed = DeployPlatformReleaseBody.safeParse(req.body);
  if (!Number.isInteger(releaseId) || releaseId < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid release deployment" });
    return;
  }
  const [release] = await db.select().from(platformReleasesTable).where(eq(platformReleasesTable.id, releaseId)).limit(1);
  const [environment] = await db.select().from(environmentsTable).where(eq(environmentsTable.id, parsed.data.environmentId)).limit(1);
  if (!release || !environment) {
    res.status(404).json({ error: "Release or environment not found" });
    return;
  }
  if (release.status !== "released" || !validReleasePayloads(release)) {
    res.status(409).json({ error: "This legacy or unreleasable release cannot be deployed" });
    return;
  }
  if (environment.kind === "production" && (release.releaseType === "security" || release.releaseType === "platform") && !release.mandatory) {
    res.status(409).json({ error: "Only mandatory security and platform releases may deploy directly to production" });
    return;
  }
  let productionSnapshot: { id: number } | undefined;
  let productionHealth: { id: number; status: string; checkedAt: Date } | undefined;
  if (environment.kind === "production") {
    const resources = await db.select({
      resourceType: environmentResourcesTable.resourceType,
      status: environmentResourcesTable.status,
    }).from(environmentResourcesTable).where(eq(environmentResourcesTable.environmentId, environment.id));
    if (!resources.length || !isIsolatedEnvironmentReady(resources)) {
      res.status(409).json({ error: "Production environment must have every isolated resource ready before release promotion" });
      return;
    }
    [productionHealth] = await db.select({
      id: environmentHealthChecksTable.id,
      status: environmentHealthChecksTable.status,
      checkedAt: environmentHealthChecksTable.checkedAt,
    })
      .from(environmentHealthChecksTable)
      .where(eq(environmentHealthChecksTable.environmentId, environment.id))
      .orderBy(desc(environmentHealthChecksTable.checkedAt)).limit(1);
    [productionSnapshot] = await db.select({ id: environmentSnapshotsTable.id })
      .from(environmentSnapshotsTable)
      .where(and(
        eq(environmentSnapshotsTable.environmentId, environment.id),
        eq(environmentSnapshotsTable.kind, "backup"),
        eq(environmentSnapshotsTable.status, "verified"),
      )).orderBy(desc(environmentSnapshotsTable.createdAt)).limit(1);
    if (!productionHealth || !isRecentHealthyCheck(productionHealth) || !productionSnapshot) {
      res.status(409).json({ error: "Production promotion requires a healthy environment check and a verified rollback snapshot" });
      return;
    }
  }
  const result = await db.transaction(async (tx) => {
    const [assignment] = await tx.select().from(environmentReleaseAssignmentsTable).where(and(
      eq(environmentReleaseAssignmentsTable.releaseId, releaseId),
      eq(environmentReleaseAssignmentsTable.environmentId, environment.id),
    )).limit(1);
    if (!assignment) return { assignment: null, alreadyDeployed: false, error: "missing" as const };
    if (release.status !== "released" || !validReleasePayloads(release)) {
      return { assignment, alreadyDeployed: false, error: "legacy" as const };
    }
    if (assignment.deploymentStatus === "deployed") return { assignment, alreadyDeployed: true, error: null };
    if (assignment.approvalStatus === "rejected") return { assignment, alreadyDeployed: false, error: "rejected" as const };
    let sourceDtdAssignmentId = assignment.sourceDtdAssignmentId;
    if (release.releaseType === "feature" && environment.kind === "production") {
      // Lock and re-check the source in the same transaction as the production
      // state change so a concurrent rejection/redeployment cannot bypass DTD.
      const [source] = await tx.select({ assignment: environmentReleaseAssignmentsTable })
        .from(environmentReleaseAssignmentsTable)
        .innerJoin(environmentsTable, eq(environmentReleaseAssignmentsTable.environmentId, environmentsTable.id))
        .where(and(
          eq(environmentReleaseAssignmentsTable.releaseId, releaseId),
          eq(environmentsTable.tenantId, environment.tenantId),
          eq(environmentsTable.kind, "dtd"),
          eq(environmentReleaseAssignmentsTable.deploymentStatus, "deployed"),
          eq(environmentReleaseAssignmentsTable.validationStatus, "validated"),
          eq(environmentReleaseAssignmentsTable.approvalStatus, "approved"),
        )).for("update").limit(1);
      if (!source) return { assignment, alreadyDeployed: false, error: "source" as const };
      sourceDtdAssignmentId = source.assignment.id;
    }
    const [updated] = await tx.update(environmentReleaseAssignmentsTable).set({
      status: "deployed",
      deploymentStatus: "deployed",
      sourceDtdAssignmentId,
      deployedByUserId: req.localUserId!,
      deployedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(environmentReleaseAssignmentsTable.id, assignment.id),
      eq(environmentReleaseAssignmentsTable.deploymentStatus, "pending"),
    )).returning();
    if (!updated) return { assignment, alreadyDeployed: true, error: null };
    await writeAuditIn(tx, req, "platform_release_deployed", environment.tenantId, {
      releaseId, assignmentId: assignment.id, environmentId: environment.id, sourceDtdAssignmentId,
    });
    if (environment.kind === "production" && productionSnapshot && productionHealth) {
      await tx.insert(environmentReleaseControlsTable).values({
        assignmentId: assignment.id,
        snapshotId: productionSnapshot.id,
        healthCheckId: productionHealth.id,
        rollbackSnapshotId: productionSnapshot.id,
        promotedAt: new Date(),
        rollbackStatus: "available",
      }).onConflictDoUpdate({
        target: environmentReleaseControlsTable.assignmentId,
        set: {
          snapshotId: productionSnapshot.id,
          healthCheckId: productionHealth.id,
          rollbackSnapshotId: productionSnapshot.id,
          promotedAt: new Date(),
          rollbackStatus: "available",
        },
      });
    }
    await writeReleaseEventIn(tx, req.localUserId!, releaseId, assignment.id, "deployed", assignment.status, updated.status, {
      environmentId: environment.id, sourceDtdAssignmentId,
    });
    return { assignment: updated, alreadyDeployed: false, error: null };
  });
  if (result.error === "missing") {
    res.status(409).json({ error: "Release must be assigned before deployment" });
    return;
  }
  if (result.error === "rejected") {
    res.status(409).json({ error: "Rejected releases cannot be deployed" });
    return;
  }
  if (result.error === "legacy") {
    res.status(409).json({ error: "This legacy or unreleasable release cannot be deployed" });
    return;
  }
  if (result.error === "source") {
    res.status(409).json({ error: "Feature production deployment requires a deployed, validated, approved Customer DTD assignment" });
    return;
  }
  const events = await db.select().from(releaseAssignmentEventsTable).where(eq(releaseAssignmentEventsTable.assignmentId, result.assignment!.id));
  const actors = await releaseActorNames(events);
  res.json({
    ...result.assignment,
    events: events.map((event) => serializeEvent(event, actors)),
  });
});

router.get("/platform/customers", async (_req: TenantRequest, res) => {
  const tenants = await db.select().from(tenantsTable).orderBy(tenantsTable.name);
  const customers = await Promise.all(tenants.map(serializeCustomer));
  res.json(customers);
});

export async function createPlatformCustomerHandler(
  req: TenantRequest,
  res: Response,
  createWorkspace: typeof createCustomerWorkspace = createCustomerWorkspace,
  createInvitation: typeof createTenantInvitation = createTenantInvitation,
) {
  const parsed = CreatePlatformCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid customer", details: parsed.error.issues });
    return;
  }
  let ownerEmail: string | null = null;
  if (parsed.data.ownerEmail) {
    try {
      ownerEmail = normalizeInvitationEmail(parsed.data.ownerEmail);
    } catch {
      res.status(400).json({ error: "Invalid customer" });
      return;
    }
  }
  if (ownerEmail) {
    const rateLimit = checkInvitationRateLimit(0, req.localUserId!);
    if (!rateLimit.allowed) {
      res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      res.status(429).json({ error: "Too many invitation requests. Please try again later." });
      return;
    }
  }
  const slug = parsed.data.slug.trim().toLowerCase();
  const [existing] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, slug))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "Customer slug already exists" });
    return;
  }

  const businessTypes = (parsed.data.businessTypes ?? DEFAULT_TENANT_BUSINESS_TYPES) as TenantBusinessType[];
  let tenant: typeof tenantsTable.$inferSelect;
  try {
    ({ tenant } = await createWorkspace(
      { name: parsed.data.name.trim(), slug, businessTypes },
      req.localUserId,
    ));
  } catch (error) {
    req.log.error({ err: error, slug }, "Customer workspace onboarding failed");
    res.status(500).json({
      error: "Customer workspace setup failed. No workspace was created. Please try again.",
    });
    return;
  }

  let invitation: ReturnType<typeof serializeInvitation> | null = null;
  let invitationToken: string | null = null;
  let invitationStatus: "not_requested" | "created" | "failed" = "not_requested";
  let invitationError: string | null = null;
  let invitationDelivery: InvitationDeliveryOutcome | null = null;
  if (ownerEmail) {
    try {
      const created = await createInvitation(
        tenant.id,
        req.localUserId!,
        ownerEmail,
        "owner",
      );
      invitation = serializeInvitation(created.invitation);
      invitationToken = created.token;
      invitationStatus = "created";
      invitationDelivery = await deliverInvitationEmail(
        {
          invitationId: created.invitation.id,
          tenantId: created.invitation.tenantId,
          actorId: req.localUserId!,
          recipient: created.invitation.email,
          customerName: tenant.name,
          role: created.invitation.role,
          token: created.token,
          expiresAt: created.invitation.expiresAt,
        },
        req.log,
      );
    } catch (error) {
      invitationStatus = "failed";
      invitationError = "Workspace created, but the owner invitation could not be created. Retry it from customer access.";
      req.log.error(
        { tenantId: tenant.id, role: "owner" },
        error instanceof ActiveTenantInvitationError
          ? "Customer workspace created with an existing owner invitation"
          : "Customer workspace created but owner invitation persistence failed",
      );
    }
  }

  await writeAudit(req, "customer_created", tenant.id, {
    name: tenant.name,
    slug: tenant.slug,
    businessTypes,
    ownerInvitationStatus: invitationStatus,
  });
  res.status(201).json({
    customer: await serializeCustomer(tenant),
    invitation,
    invitationToken,
    ownerEmail: invitationStatus === "failed" ? ownerEmail : null,
    invitationStatus,
    invitationError,
    invitationDelivery,
  });
}

router.post("/platform/customers", (req, res) => createPlatformCustomerHandler(req, res));

router.get("/platform/customers/:tenantId", async (req: TenantRequest, res) => {
  const tenantId = Number(req.params.tenantId);
  if (!Number.isInteger(tenantId) || tenantId < 1) {
    res.status(400).json({ error: "Invalid customer" });
    return;
  }
  const tenant = await getCustomer(tenantId);
  if (!tenant) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(await serializeCustomerDetails(tenant));
});

router.get("/platform/customers/:tenantId/audit-events", async (req: TenantRequest, res) => {
  const tenantId = Number(req.params.tenantId);
  if (!Number.isInteger(tenantId) || tenantId < 1) {
    res.status(400).json({ error: "Invalid customer" });
    return;
  }
  const tenant = await getCustomer(tenantId);
  if (!tenant) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  const events = await db
    .select({
      id: platformAuditEventsTable.id,
      tenantId: platformAuditEventsTable.tenantId,
      action: platformAuditEventsTable.action,
      details: platformAuditEventsTable.details,
      createdAt: platformAuditEventsTable.createdAt,
      actorId: usersTable.id,
      actorEmail: usersTable.email,
      actorDisplayName: usersTable.displayName,
    })
    .from(platformAuditEventsTable)
    .innerJoin(usersTable, eq(platformAuditEventsTable.actorUserId, usersTable.id))
    .where(eq(platformAuditEventsTable.tenantId, tenantId))
    .orderBy(desc(platformAuditEventsTable.createdAt), desc(platformAuditEventsTable.id))
    .limit(100);

  const parsedEvents = events.map((event) => ({
    ...event,
    parsedDetails: parseAuditDetails(event.details),
  }));
  const affectedUserIds = [...new Set(
    parsedEvents
      .map(({ parsedDetails }) => parsedDetails.userId)
      .filter(isSafeUserId),
  )];
  const affectedUsers = affectedUserIds.length === 0
    ? []
    : await db
      .select({ id: usersTable.id, email: usersTable.email, displayName: usersTable.displayName })
      .from(usersTable)
      .where(inArray(usersTable.id, affectedUserIds));
  const affectedUsersById = new Map(affectedUsers.map((user) => [user.id, user]));

  res.json(parsedEvents.map(({ details: _details, parsedDetails, ...event }) => {
    const affectedUserId = isSafeUserId(parsedDetails.userId) ? parsedDetails.userId : null;
    return {
      ...event,
      details: parsedDetails,
      actor: {
        id: event.actorId,
        email: event.actorEmail,
        displayName: event.actorDisplayName,
      },
      affectedUser: affectedUserId === null ? null : (affectedUsersById.get(affectedUserId) ?? null),
      workspace: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
    };
  }));
});

router.post("/platform/customers/:tenantId/invitations", async (req: TenantRequest, res) => {
  const tenantId = Number(req.params.tenantId);
  const parsed = CreatePlatformCustomerInvitationBody.safeParse(req.body);
  if (!Number.isInteger(tenantId) || tenantId < 1 || !parsed.success) {
    res.status(400).json({ error: "Invalid customer invitation" });
    return;
  }
  const tenant = await getCustomer(tenantId);
  if (!tenant) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  if (tenant.status !== "active") {
    res.status(409).json({ error: "Suspended customers cannot receive invitations" });
    return;
  }
  let email: string;
  try {
    email = normalizeInvitationEmail(parsed.data.email);
  } catch {
    res.status(400).json({ error: "Invalid customer invitation" });
    return;
  }
  const [existingInvite] = await db
    .select()
    .from(tenantInvitationsTable)
    .where(
      and(
        eq(tenantInvitationsTable.tenantId, tenantId),
        eq(tenantInvitationsTable.email, email),
        sql`${tenantInvitationsTable.acceptedAt} is null`,
        sql`${tenantInvitationsTable.revokedAt} is null`,
        sql`${tenantInvitationsTable.expiresAt} > now()`,
      ),
    )
    .limit(1);
  if (existingInvite) {
    res.status(409).json({ error: "An active invitation already exists for this email" });
    return;
  }
  const rateLimit = checkInvitationRateLimit(tenantId, req.localUserId!);
  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    res.status(429).json({ error: "Too many invitation requests. Please try again later." });
    return;
  }
  try {
    const created = await createTenantInvitation(tenantId, req.localUserId!, email, parsed.data.role);
    const delivery: InvitationDeliveryOutcome = await deliverInvitationEmail(
      {
        invitationId: created.invitation.id,
        tenantId: created.invitation.tenantId,
        actorId: req.localUserId!,
        recipient: created.invitation.email,
        customerName: tenant.name,
        role: created.invitation.role,
        token: created.token,
        expiresAt: created.invitation.expiresAt,
      },
      req.log,
    );
    res.status(201).json({
      invitation: serializeInvitation(created.invitation),
      token: created.token,
      delivery,
    });
  } catch (error) {
    if (error instanceof ActiveTenantInvitationError || error instanceof InvalidTenantInvitationError) {
      res.status(error instanceof ActiveTenantInvitationError ? 409 : 400).json({ error: error.message });
      return;
    }
    req.log.error(
      { tenantId, role: parsed.data.role },
      "Platform invitation persistence failed",
    );
    res.status(500).json({ error: "Invitation could not be created. Please try again." });
  }
});

router.post("/platform/customers/:tenantId/invitations/:invitationId/revoke", async (req: TenantRequest, res) => {
  const tenantId = Number(req.params.tenantId);
  const invitationId = Number(req.params.invitationId);
  if (
    !Number.isInteger(tenantId) ||
    tenantId < 1 ||
    !Number.isInteger(invitationId) ||
    invitationId < 1
  ) {
    res.status(400).json({ error: "Invalid customer invitation" });
    return;
  }
  const tenant = await getCustomer(tenantId);
  if (!tenant) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  const invitation = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(tenantInvitationsTable)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(tenantInvitationsTable.id, invitationId),
        eq(tenantInvitationsTable.tenantId, tenantId),
        isNull(tenantInvitationsTable.acceptedAt),
        isNull(tenantInvitationsTable.revokedAt),
        gt(tenantInvitationsTable.expiresAt, new Date()),
      ))
      .returning();
    if (!updated) return null;
    await writeAuditIn(tx, req, "customer_invitation_revoked", tenantId, {
      invitationId: updated.id,
      role: updated.role,
    });
    return updated;
  });
  if (!invitation) {
    res.status(409).json({ error: "Invitation is no longer pending" });
    return;
  }
  res.json(serializeInvitation(invitation));
});

router.patch("/platform/customers/:tenantId/members/:userId", async (req: TenantRequest, res) => {
  const tenantId = Number(req.params.tenantId);
  const userId = Number(req.params.userId);
  const parsed = UpdatePlatformCustomerMemberBody.safeParse(req.body);
  if (
    !Number.isInteger(tenantId) ||
    tenantId < 1 ||
    !Number.isInteger(userId) ||
    userId < 1 ||
    !parsed.success
  ) {
    res.status(400).json({ error: "Invalid customer member update" });
    return;
  }
  const tenant = await getCustomer(tenantId);
  if (!tenant) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  const [membership] = await db
    .select()
    .from(membershipsTable)
    .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.userId, userId)))
    .limit(1);
  if (!membership) {
    res.status(404).json({ error: "Customer member not found" });
    return;
  }
  if (membership.role === "owner" && parsed.data.role !== "owner") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(membershipsTable)
      .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.role, "owner")));
    if (Number(count) <= 1) {
      res.status(409).json({ error: "A customer must retain one owner" });
      return;
    }
  }
  if (parsed.data.environmentIds) {
    if (new Set(parsed.data.environmentIds).size !== parsed.data.environmentIds.length) {
      res.status(400).json({ error: "Environment access contains duplicate environments" });
      return;
    }
    const environments = await db
      .select({ id: environmentsTable.id })
      .from(environmentsTable)
      .where(
        and(
          eq(environmentsTable.tenantId, tenantId),
          inArray(environmentsTable.id, parsed.data.environmentIds),
          eq(environmentsTable.status, "active"),
        ),
      );
    if (environments.length !== parsed.data.environmentIds.length) {
      res.status(400).json({ error: "One or more environments are not active for this customer" });
      return;
    }
  }
  await db.transaction(async (tx) => {
    await tx
      .update(membershipsTable)
      .set({ role: parsed.data.role, environmentAccessConfigured: parsed.data.environmentIds !== undefined ? true : undefined })
      .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.userId, userId)));
    if (parsed.data.environmentIds) {
      await tx
        .delete(tenantEnvironmentAccessTable)
        .where(and(eq(tenantEnvironmentAccessTable.tenantId, tenantId), eq(tenantEnvironmentAccessTable.userId, userId)));
      if (parsed.data.environmentIds.length > 0) {
        await tx.insert(tenantEnvironmentAccessTable).values(
          parsed.data.environmentIds.map((environmentId) => ({
            tenantId,
            environmentId,
            userId,
            grantedByUserId: req.localUserId!,
          })),
        );
      }
    }
  });
  await writeAudit(req, "customer_member_access_updated", tenantId, {
    userId,
    role: parsed.data.role,
    environmentIds: parsed.data.environmentIds,
  });
  res.json(await serializeMember(tenantId, userId));
});

router.delete("/platform/customers/:tenantId/members/:userId", async (req: TenantRequest, res) => {
  const tenantId = Number(req.params.tenantId);
  const userId = Number(req.params.userId);
  if (!Number.isInteger(tenantId) || tenantId < 1 || !Number.isInteger(userId) || userId < 1) {
    res.status(400).json({ error: "Invalid customer member" });
    return;
  }
  const [membership] = await db
    .select()
    .from(membershipsTable)
    .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.userId, userId)))
    .limit(1);
  if (!membership) {
    res.status(404).json({ error: "Customer member not found" });
    return;
  }
  if (membership.role === "owner") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(membershipsTable)
      .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.role, "owner")));
    if (Number(count) <= 1) {
      res.status(409).json({ error: "A customer must retain one owner" });
      return;
    }
  }
  await db
    .delete(membershipsTable)
    .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.userId, userId)));
  await writeAudit(req, "customer_member_removed", tenantId, { userId });
  res.status(204).send();
});

router.patch("/platform/customers/:tenantId", async (req: TenantRequest, res) => {
  const tenantId = Number(req.params.tenantId);
  const parsed = UpdatePlatformCustomerBody.safeParse(req.body);
  if (!parsed.success || !Number.isInteger(tenantId) || tenantId < 1) {
    res.status(400).json({ error: "Invalid customer update" });
    return;
  }
  const [currentTenant] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  if (!currentTenant) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  const [tenant] = await db
    .update(tenantsTable)
    .set({
      status: parsed.data.status,
      ...(parsed.data.customerBrandingEnabled === undefined
        ? {}
        : { customerBrandingEnabled: parsed.data.customerBrandingEnabled }),
      updatedAt: new Date(),
    })
    .where(eq(tenantsTable.id, tenantId))
    .returning();
  if (!tenant) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  if (currentTenant.status !== tenant.status) {
    await writeAudit(req, "customer_status_changed", tenant.id, { status: tenant.status });
  }
  if (
    parsed.data.customerBrandingEnabled !== undefined
    && currentTenant.customerBrandingEnabled !== tenant.customerBrandingEnabled
  ) {
    await writeAudit(req, "customer_branding_changed", tenant.id, {
      customerBrandingEnabled: tenant.customerBrandingEnabled,
    });
  }
  res.json(await serializeCustomer(tenant));
});

export default router;