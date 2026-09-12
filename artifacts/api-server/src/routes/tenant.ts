import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, environmentsTable, membershipsTable, tenantBrandingDraftsTable, tenantBrandingVersionsTable, tenantsTable, userTenantContextTable } from "@workspace/db";
import { SaveBrandingDraftBody, SwitchEnvironmentBody, SwitchTenantBody, RollbackBrandingParams } from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";

const router: IRouter = Router();
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
        role: membershipsTable.role,
      })
        .from(membershipsTable)
        .innerJoin(tenantsTable, eq(membershipsTable.tenantId, tenantsTable.id))
        .where(eq(membershipsTable.userId, req.localUserId!));
  const environments = await db.select().from(environmentsTable)
    .where(eq(environmentsTable.tenantId, req.tenantId!)).orderBy(environmentsTable.name);
  const activeEnvironment = environments.find(x => x.id === req.environmentId) ?? environments[0];
  return {
    activeTenant: memberships.find(x => x.id === req.tenantId),
    memberships,
    activeEnvironment,
    environments,
    environmentLabel: req.environmentLabel ?? process.env.APP_ENV ?? "development",
    isPlatformAdmin: Boolean(req.isPlatformAdmin),
  };
};

router.get("/tenant/context", async (req: TenantRequest, res) => res.json(await context(req)));
router.post("/tenant/context", async (req: TenantRequest, res) => {
  const parsed = SwitchTenantBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid tenant" }); return; }
  if (!req.isPlatformAdmin) {
    const [membership] = await db.select().from(membershipsTable).where(and(eq(membershipsTable.userId, req.localUserId!), eq(membershipsTable.tenantId, parsed.data.tenantId)));
    if (!membership) { res.status(403).json({ error: "Tenant membership required" }); return; }
  }
  const [tenant] = await db.select({ id: tenantsTable.id, status: tenantsTable.status })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, parsed.data.tenantId), eq(tenantsTable.status, "active")))
    .limit(1);
  if (!tenant) { res.status(404).json({ error: "Customer workspace not found" }); return; }
  const [environment] = await db.select().from(environmentsTable)
    .where(eq(environmentsTable.tenantId, parsed.data.tenantId))
    .orderBy(sql`case when ${environmentsTable.kind} = 'dtd' then 0 else 1 end`, environmentsTable.id)
    .limit(1);
  if (!environment) { res.status(409).json({ error: "Customer has no environment" }); return; }
  await db.update(userTenantContextTable).set({ activeTenantId: parsed.data.tenantId, activeEnvironmentId: environment.id, updatedAt: new Date() }).where(eq(userTenantContextTable.userId, req.localUserId!));
  req.tenantId = parsed.data.tenantId;
  req.environmentId = environment.id;
  res.json(await context(req));
});
router.get("/tenant/environments", async (req: TenantRequest, res) => {
  const environments = await db.select().from(environmentsTable)
    .where(eq(environmentsTable.tenantId, req.tenantId!)).orderBy(environmentsTable.name);
  res.json(environments);
});
router.post("/tenant/environments", async (req: TenantRequest, res) => {
  const parsed = SwitchEnvironmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid environment" }); return; }
  const [environment] = await db.select().from(environmentsTable).where(and(
    eq(environmentsTable.id, parsed.data.environmentId), eq(environmentsTable.tenantId, req.tenantId!),
  ));
  if (!environment) { res.status(403).json({ error: "Environment access required" }); return; }
  await db.update(userTenantContextTable).set({ activeEnvironmentId: environment.id, updatedAt: new Date() })
    .where(eq(userTenantContextTable.userId, req.localUserId!));
  req.environmentId = environment.id;
  res.json(await context(req));
});
router.get("/tenant/branding/published", async (req: TenantRequest, res) => {
  const published = await db.select().from(tenantBrandingVersionsTable).where(and(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!), eq(tenantBrandingVersionsTable.environmentId, req.environmentId!))).orderBy(desc(tenantBrandingVersionsTable.version));
  res.json({ published: published.map(v => ({ ...v, data: parse(v.data) })) });
});
router.get("/tenant/branding", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const [draft] = await db.select().from(tenantBrandingDraftsTable).where(and(eq(tenantBrandingDraftsTable.tenantId, req.tenantId!), eq(tenantBrandingDraftsTable.environmentId, req.environmentId!)));
  const published = await db.select().from(tenantBrandingVersionsTable).where(and(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!), eq(tenantBrandingVersionsTable.environmentId, req.environmentId!))).orderBy(desc(tenantBrandingVersionsTable.version));
  res.json({ draft: draft ? parse(draft.data) : defaults, published: published.map(v => ({ ...v, data: parse(v.data) })) });
});
router.put("/tenant/branding", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const parsed = SaveBrandingDraftBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid branding", details: parsed.error.issues }); return; }
  await db.insert(tenantBrandingDraftsTable).values({ tenantId: req.tenantId!, environmentId: req.environmentId!, data: JSON.stringify(parsed.data), updatedByUserId: req.localUserId! })
    .onConflictDoUpdate({ target: [tenantBrandingDraftsTable.tenantId, tenantBrandingDraftsTable.environmentId], set: { data: JSON.stringify(parsed.data), updatedByUserId: req.localUserId!, updatedAt: new Date() } });
  const published = await db.select().from(tenantBrandingVersionsTable).where(and(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!), eq(tenantBrandingVersionsTable.environmentId, req.environmentId!))).orderBy(desc(tenantBrandingVersionsTable.version));
  res.json({ draft: parsed.data, published: published.map(v => ({ ...v, data: parse(v.data) })) });
});
router.post("/tenant/branding/publish", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
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
router.post("/tenant/branding/rollback/:version", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
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
router.post("/tenant/branding/reset", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  await db.insert(tenantBrandingDraftsTable).values({ tenantId: req.tenantId!, environmentId: req.environmentId!, data: JSON.stringify(defaults), updatedByUserId: req.localUserId! }).onConflictDoUpdate({ target: [tenantBrandingDraftsTable.tenantId, tenantBrandingDraftsTable.environmentId], set: { data: JSON.stringify(defaults), updatedByUserId: req.localUserId!, updatedAt: new Date() } });
  const published = await db.select().from(tenantBrandingVersionsTable).where(and(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!), eq(tenantBrandingVersionsTable.environmentId, req.environmentId!))).orderBy(desc(tenantBrandingVersionsTable.version));
  res.json({ draft: defaults, published: published.map(v => ({ ...v, data: parse(v.data) })) });
});
export default router;