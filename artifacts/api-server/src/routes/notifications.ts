import { Router, type IRouter } from "express";
import { and, desc, eq, lte } from "drizzle-orm";
import { activityTable, db, followUpsTable, notificationReadsTable, projectsTable } from "@workspace/db";
import { ListNotificationsQueryParams, MarkNotificationsReadBody } from "@workspace/api-zod";
import type { TenantRequest } from "../middlewares/tenantContext";

const router: IRouter = Router();

type NotificationSeed = {
  key: string;
  kind: "activity" | "follow_up";
  title: string;
  description: string;
  href: string;
  severity: "info" | "attention" | "urgent";
  createdAt: Date;
  projectId: number | null;
  projectName: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

async function getNotificationSeeds(req: TenantRequest): Promise<NotificationSeed[]> {
  const [activity, dueFollowUps] = await Promise.all([
    db.select({
      id: activityTable.id,
      projectId: activityTable.projectId,
      projectName: projectsTable.projectName,
      action: activityTable.action,
      description: activityTable.description,
      createdAt: activityTable.createdAt,
    })
      .from(activityTable)
      .leftJoin(projectsTable, and(
        eq(activityTable.projectId, projectsTable.id),
        eq(projectsTable.tenantId, req.tenantId!),
        eq(projectsTable.environmentId, req.environmentId!),
      ))
      .where(and(
        eq(activityTable.tenantId, req.tenantId!),
        eq(activityTable.environmentId, req.environmentId!),
      ))
      .orderBy(desc(activityTable.createdAt))
      .limit(30),
    db.select({
      id: followUpsTable.id,
      projectId: followUpsTable.projectId,
      projectName: projectsTable.projectName,
      dueDate: followUpsTable.dueDate,
      note: followUpsTable.note,
      createdAt: followUpsTable.createdAt,
    })
      .from(followUpsTable)
      .innerJoin(projectsTable, and(
        eq(followUpsTable.projectId, projectsTable.id),
        eq(followUpsTable.tenantId, projectsTable.tenantId),
        eq(followUpsTable.environmentId, projectsTable.environmentId),
      ))
      .where(and(
        eq(followUpsTable.tenantId, req.tenantId!),
        eq(followUpsTable.environmentId, req.environmentId!),
        eq(followUpsTable.status, "open"),
        lte(followUpsTable.dueDate, today()),
      ))
      .orderBy(followUpsTable.dueDate)
      .limit(20),
  ]);

  const followUpSeeds = dueFollowUps.map((item) => ({
    key: `follow_up:${item.id}`,
    kind: "follow_up" as const,
    title: item.dueDate < today() ? "Follow-up overdue" : "Follow-up due today",
    description: `${item.projectName}: ${item.note}`,
    href: `/projects/${item.projectId}`,
    severity: item.dueDate < today() ? "urgent" as const : "attention" as const,
    createdAt: item.createdAt,
    projectId: item.projectId,
    projectName: item.projectName,
  }));
  const activitySeeds = activity.map((item) => ({
    key: `activity:${item.id}`,
    kind: "activity" as const,
    title: item.action,
    description: item.description,
    href: `/projects/${item.projectId}`,
    severity: "info" as const,
    createdAt: item.createdAt,
    projectId: item.projectId,
    projectName: item.projectName,
  }));

  return [...followUpSeeds, ...activitySeeds]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

async function getReadKeys(req: TenantRequest, keys: string[]) {
  if (keys.length === 0) return new Set<string>();
  const rows = await db.select({ notificationKey: notificationReadsTable.notificationKey })
    .from(notificationReadsTable)
    .where(and(
      eq(notificationReadsTable.tenantId, req.tenantId!),
      eq(notificationReadsTable.environmentId, req.environmentId!),
      eq(notificationReadsTable.userId, req.localUserId!),
    ));
  const requested = new Set(keys);
  return new Set(rows.map((row) => row.notificationKey).filter((key) => requested.has(key)));
}

async function markRead(req: TenantRequest, notificationKeys: string[]) {
  const seeds = await getNotificationSeeds(req);
  const validKeys = new Set(seeds.map((item) => item.key));
  const keys = [...new Set(notificationKeys)].filter((key) => validKeys.has(key));
  if (keys.length === 0) return;

  await db.insert(notificationReadsTable)
    .values(keys.map((notificationKey) => ({
      tenantId: req.tenantId!,
      environmentId: req.environmentId!,
      userId: req.localUserId!,
      notificationKey,
    })))
    .onConflictDoNothing();
}

router.get("/notifications", async (req: TenantRequest, res) => {
  const parsed = ListNotificationsQueryParams.safeParse({
    status: req.query.status,
    limit: req.query.limit,
  });
  const filters = parsed.success ? parsed.data : { status: "all" as const, limit: 30 };
  const seeds = await getNotificationSeeds(req);
  const readKeys = await getReadKeys(req, seeds.map((item) => item.key));
  const allItems = seeds.map((item) => ({ ...item, read: readKeys.has(item.key) }));
  const items = (filters.status === "unread" ? allItems.filter((item) => !item.read) : allItems)
    .slice(0, filters.limit);

  res.json({
    items,
    unreadCount: allItems.filter((item) => !item.read).length,
  });
});

router.post("/notifications/read", async (req: TenantRequest, res) => {
  const parsed = MarkNotificationsReadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid notification keys" });
    return;
  }
  await markRead(req, parsed.data.notificationKeys);
  res.status(204).send();
});

router.post("/notifications/read-all", async (req: TenantRequest, res) => {
  const seeds = await getNotificationSeeds(req);
  await markRead(req, seeds.map((item) => item.key));
  res.status(204).send();
});

export default router;