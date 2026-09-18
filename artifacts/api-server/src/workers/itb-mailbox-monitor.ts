import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  db,
  integrationsTable,
  itbIntakesTable,
  itbMailboxCursorsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { createItbMailboxClient, type MailboxProvider } from "../lib/itb-mailbox";
import { ingestItbMailboxMessage } from "../lib/itb-mailbox-ingestion";
import {
  mailboxProviderFromIntegrationKey,
  parseItbMailboxMonitorConfig,
} from "../lib/itb-mailbox-monitor-config";
import {
  markIntegrationJobFailed,
  markIntegrationJobSucceeded,
  startIntegrationJob,
  type IntegrationJobScope,
} from "../lib/integrations/job-lifecycle";

const SWEEP_INTERVAL_MS = 30_000;
const PAGE_SIZE = 20;
const activeStop: { stop?: () => void } = {};

const dueForMonitor = (lastRunAt: Date | null, intervalSeconds: number, now: Date) =>
  !lastRunAt || lastRunAt.getTime() <= now.getTime() - intervalSeconds * 1000;

const claimIntegration = async (integration: typeof integrationsTable.$inferSelect, now: Date, intervalSeconds: number) => {
  const threshold = new Date(now.getTime() - intervalSeconds * 1000);
  const [claimed] = await db.update(integrationsTable).set({
    lastSyncAt: now,
    lastSyncStatus: "processing",
    updatedAt: now,
  }).where(and(
    eq(integrationsTable.id, integration.id),
    eq(integrationsTable.status, "connected"),
    or(isNull(integrationsTable.lastSyncAt), lt(integrationsTable.lastSyncAt, threshold)),
  )).returning();
  return claimed;
};

async function monitorIntegration(
  integration: typeof integrationsTable.$inferSelect,
  provider: MailboxProvider,
) {
  const config = parseItbMailboxMonitorConfig(integration.configuration, provider);
  const now = new Date();
  if (!config.enabled || !dueForMonitor(integration.lastSyncAt, config.intervalSeconds, now)) return;

  const claimed = await claimIntegration(integration, now, config.intervalSeconds);
  if (!claimed) return;

  const providerKey = claimed.providerKey;
  const scope: IntegrationJobScope = {
    tenantId: claimed.tenantId,
    environmentId: claimed.environmentId,
    integrationId: claimed.id,
    providerKey,
  };
  const job = await startIntegrationJob(scope, "itb_mailbox_monitor");
  const mailboxClient = createItbMailboxClient(new ReplitConnectors());

  try {
    const mailboxResult = await mailboxClient.preview(provider, config.query, PAGE_SIZE);
    let importedCount = 0;
    let existingCount = 0;

    for (const preview of mailboxResult.previews) {
      const existing = await db.select({ id: itbIntakesTable.id }).from(itbIntakesTable).where(and(
        eq(itbIntakesTable.tenantId, claimed.tenantId),
        eq(itbIntakesTable.environmentId, claimed.environmentId),
        eq(itbIntakesTable.sourceProvider, provider),
        eq(itbIntakesTable.sourceMessageId, preview.messageId),
      )).limit(1);
      if (existing.length) {
        existingCount += 1;
        continue;
      }

      try {
        const message = await mailboxClient.importMessage(provider, preview.threadId, preview.messageId);
        const result = await ingestItbMailboxMessage(message, {
          tenantId: claimed.tenantId,
          environmentId: claimed.environmentId,
          sourceMailbox: config.mailbox,
          createdByUserId: null,
          auditAction: "itb_mailbox_message_monitored",
        });
        if (result.kind === "created") importedCount += 1;
        else existingCount += 1;
      } catch (error) {
        logger.warn({
          err: error,
          tenantId: claimed.tenantId,
          environmentId: claimed.environmentId,
          provider,
          messageId: preview.messageId,
        }, "ITB mailbox message could not be monitored");
      }
    }

    await db.insert(itbMailboxCursorsTable).values({
      tenantId: claimed.tenantId,
      environmentId: claimed.environmentId,
      provider,
      mailbox: config.mailbox,
      query: config.query,
      nextPageToken: null,
      lastSyncedAt: now,
    }).onConflictDoUpdate({
      target: [
        itbMailboxCursorsTable.tenantId,
        itbMailboxCursorsTable.environmentId,
        itbMailboxCursorsTable.provider,
        itbMailboxCursorsTable.mailbox,
        itbMailboxCursorsTable.query,
      ],
      set: {
        nextPageToken: null,
        lastSyncedAt: now,
        updatedAt: now,
      },
    });
    await markIntegrationJobSucceeded(scope, job);
    logger.info({
      tenantId: claimed.tenantId,
      environmentId: claimed.environmentId,
      provider,
      importedCount,
      existingCount,
    }, "ITB mailbox monitor sweep completed");
  } catch (error) {
    await markIntegrationJobFailed(scope, job, error);
    logger.warn({
      err: error,
      tenantId: claimed.tenantId,
      environmentId: claimed.environmentId,
      provider,
    }, "ITB mailbox monitor sweep failed");
  }
}

export async function runItbMailboxMonitorSweep() {
  const integrations = await db.select().from(integrationsTable).where(and(
    eq(integrationsTable.status, "connected"),
    inArray(integrationsTable.providerKey, ["google_workspace", "microsoft_365"]),
  ));
  const now = new Date();
  for (const integration of integrations) {
    const provider = mailboxProviderFromIntegrationKey(integration.providerKey);
    if (!provider) continue;
    await monitorIntegration(integration, provider);
  }
}

export function startItbMailboxMonitorWorker(intervalMs = SWEEP_INTERVAL_MS): () => void {
  if (activeStop.stop) return activeStop.stop;
  let stopped = false;
  let running = false;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runItbMailboxMonitorSweep();
    } catch (error) {
      logger.warn({ err: error }, "ITB mailbox monitor sweep unavailable");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (activeStop.stop === stop) activeStop.stop = undefined;
  };
  activeStop.stop = stop;
  void run();
  return stop;
}