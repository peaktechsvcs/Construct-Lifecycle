import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, membershipsTable, tenantBrandingDraftsTable, tenantBrandingVersionsTable, tenantsTable, userTenantContextTable } from "@workspace/db";
import { SaveBrandingDraftBody, SwitchTenantBody, RollbackBrandingParams } from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";
import { requireRole } from "../middlewares/rbac";

const router: IRouter = Router();
const defaults = { logoUrl: null, primaryColor: "#1f4d3a", secondaryColor: "#f5f1e8", accentColor: "#c67c4e", backgroundColor: "#ffffff", foregroundColor: "#17211b" };
const parse = (s: string) => { try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; } };
const contrast = (a: string, b: string) => {
  const lum = (hex: string) => {
    const c = hex.replace("#", "").match(/.{2}/g)?.map(x => parseInt(x, 16) / 255) ?? [0, 0, 0];
    return c.reduce((sum, x) => sum + (x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][c.indexOf(x)], 0);
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
  const memberships = await db.select({ id: tenantsTable.id, name: tenantsTable.name, slug: tenantsTable.slug, role: membershipsTable.role })
    .from(membershipsTable).innerJoin(tenantsTable, eq(membershipsTable.tenantId, tenantsTable.id)).where(eq(membershipsTable.userId, req.localUserId!));
  return { activeTenant: memberships.find(x => x.id === req.tenantId), memberships };
};

router.get("/tenant/context", async (req: TenantRequest, res) => res.json(await context(req)));
router.post("/tenant/context", async (req: TenantRequest, res) => {
  const parsed = SwitchTenantBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid tenant" }); return; }
  const [membership] = await db.select().from(membershipsTable).where(and(eq(membershipsTable.userId, req.localUserId!), eq(membershipsTable.tenantId, parsed.data.tenantId)));
  if (!membership) { res.status(403).json({ error: "Tenant membership required" }); return; }
  await db.update(userTenantContextTable).set({ activeTenantId: parsed.data.tenantId, updatedAt: new Date() }).where(eq(userTenantContextTable.userId, req.localUserId!));
  req.tenantId = parsed.data.tenantId; res.json(await context(req));
});
router.get("/tenant/branding", async (req: TenantRequest, res) => {
  const [draft] = await db.select().from(tenantBrandingDraftsTable).where(eq(tenantBrandingDraftsTable.tenantId, req.tenantId!));
  const published = await db.select().from(tenantBrandingVersionsTable).where(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!)).orderBy(desc(tenantBrandingVersionsTable.version));
  res.json({ draft: draft ? parse(draft.data) : defaults, published: published.map(v => ({ ...v, data: parse(v.data) })) });
});
router.put("/tenant/branding", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const parsed = SaveBrandingDraftBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid branding", details: parsed.error.issues }); return; }
  await db.insert(tenantBrandingDraftsTable).values({ tenantId: req.tenantId!, data: JSON.stringify(parsed.data), updatedByUserId: req.localUserId! })
    .onConflictDoUpdate({ target: tenantBrandingDraftsTable.tenantId, set: { data: JSON.stringify(parsed.data), updatedByUserId: req.localUserId!, updatedAt: new Date() } });
  const published = await db.select().from(tenantBrandingVersionsTable).where(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!)).orderBy(desc(tenantBrandingVersionsTable.version));
  res.json({ draft: parsed.data, published: published.map(v => ({ ...v, data: parse(v.data) })) });
});
router.post("/tenant/branding/publish", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const [draft] = await db.select().from(tenantBrandingDraftsTable).where(eq(tenantBrandingDraftsTable.tenantId, req.tenantId!));
  const data = draft ? parse(draft.data) : defaults;
  const failures = validateContrast(data);
  if (failures.length) { res.status(422).json({ error: "Branding fails WCAG AA contrast validation", failures }); return; }
  const [version] = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${req.tenantId!})`);
    const [{ max }] = await tx.select({ max: tenantBrandingVersionsTable.version }).from(tenantBrandingVersionsTable).where(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!));
    return tx.insert(tenantBrandingVersionsTable).values({ tenantId: req.tenantId!, version: Number(max ?? 0) + 1, data: JSON.stringify(data), publishedByUserId: req.localUserId! }).returning();
  });
  res.json({ ...version, data });
});
router.post("/tenant/branding/rollback/:version", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  const parsed = RollbackBrandingParams.safeParse(req.params); if (!parsed.success) { res.status(400).json({ error: "Invalid version" }); return; }
  const [version] = await db.select().from(tenantBrandingVersionsTable).where(and(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!), eq(tenantBrandingVersionsTable.version, parsed.data.version)));
  if (!version) { res.status(404).json({ error: "Version not found" }); return; }
  await db.insert(tenantBrandingDraftsTable).values({ tenantId: req.tenantId!, data: version.data, updatedByUserId: req.localUserId! }).onConflictDoUpdate({ target: tenantBrandingDraftsTable.tenantId, set: { data: version.data, updatedByUserId: req.localUserId!, updatedAt: new Date() } });
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${req.tenantId!})`);
    const [{ max }] = await tx.select({ max: tenantBrandingVersionsTable.version }).from(tenantBrandingVersionsTable).where(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!));
    await tx.insert(tenantBrandingVersionsTable).values({ tenantId: req.tenantId!, version: Number(max ?? 0) + 1, data: version.data, publishedByUserId: req.localUserId! });
  });
  const history = await db.select().from(tenantBrandingVersionsTable).where(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!)).orderBy(desc(tenantBrandingVersionsTable.version));
  res.json({ draft: parse(version.data), published: history.map(v => ({ ...v, data: parse(v.data) })) });
});
router.post("/tenant/branding/reset", requireRole("owner", "admin"), async (req: TenantRequest, res) => {
  await db.insert(tenantBrandingDraftsTable).values({ tenantId: req.tenantId!, data: JSON.stringify(defaults), updatedByUserId: req.localUserId! }).onConflictDoUpdate({ target: tenantBrandingDraftsTable.tenantId, set: { data: JSON.stringify(defaults), updatedByUserId: req.localUserId!, updatedAt: new Date() } });
  const published = await db.select().from(tenantBrandingVersionsTable).where(eq(tenantBrandingVersionsTable.tenantId, req.tenantId!)).orderBy(desc(tenantBrandingVersionsTable.version));
  res.json({ draft: defaults, published: published.map(v => ({ ...v, data: parse(v.data) })) });
});
export default router;