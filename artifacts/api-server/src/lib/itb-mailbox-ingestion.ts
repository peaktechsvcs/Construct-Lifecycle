import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  itbIntakeAttachmentsTable,
  itbIntakesTable,
  platformAuditEventsTable,
} from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { extractItb } from "./itb-extraction";
import type { ImportedMailboxMessage, MailboxProvider } from "./itb-mailbox";

const MAX_SOURCE_CHARS = 200_000;
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const objectStorage = new ObjectStorageService();

export type ItbMailboxIngestionContext = {
  tenantId: number;
  environmentId: number;
  sourceMailbox: string;
  createdByUserId: number | null;
  auditAction: "itb_mailbox_message_imported" | "itb_mailbox_message_monitored";
};

export type ItbMailboxIngestionResult =
  | { kind: "created"; intakeId: number }
  | { kind: "existing"; intakeId: number };

const fingerprint = (parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex");

const privatePrefix = () => {
  const privateDir = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!privateDir) return "/objects/";
  const normalized = privateDir.startsWith("/") ? privateDir : `/${privateDir}`;
  const [, ...objectParts] = normalized.split("/").slice(1);
  const objectPrefix = objectParts.filter(Boolean).join("/");
  return `/objects/${objectPrefix ? `${objectPrefix}/` : ""}itb-intakes/`;
};

const isOwnedItbObject = (path: string) => path.startsWith(privatePrefix()) && path.length > privatePrefix().length;

const cleanupObjects = async (objectPaths: string[]) => {
  await Promise.all(objectPaths.map(async (objectPath) => {
    try {
      await objectStorage.deleteObject(objectPath);
    } catch {
      // The intake remains reviewable even if cleanup needs an operator retry.
    }
  }));
};

export async function ingestItbMailboxMessage(
  message: ImportedMailboxMessage,
  context: ItbMailboxIngestionContext,
): Promise<ItbMailboxIngestionResult> {
  const existing = await db.select({ id: itbIntakesTable.id }).from(itbIntakesTable).where(and(
    eq(itbIntakesTable.tenantId, context.tenantId),
    eq(itbIntakesTable.environmentId, context.environmentId),
    eq(itbIntakesTable.sourceProvider, message.sourceProvider),
    eq(itbIntakesTable.sourceMessageId, message.sourceMessageId),
  )).limit(1);
  if (existing.length) return { kind: "existing", intakeId: existing[0].id };

  const storedObjectPaths: string[] = [];
  try {
    const { extraction, warnings } = extractItb(message.sourceSubject, message.sourceBody.slice(0, MAX_SOURCE_CHARS));
    const storedAttachments: Array<{
      originalName: string;
      contentType: string;
      size: number;
      objectPath: string;
      sourceAttachmentId: string;
    }> = [];

    for (const attachment of message.attachments.slice(0, 20)) {
      if (!Number.isFinite(attachment.size) || attachment.size <= 0 || attachment.size > MAX_ATTACHMENT_BYTES) continue;
      const stored = await objectStorage.storeBytes("itb-intakes", attachment.bytes, attachment.contentType);
      storedObjectPaths.push(stored.objectPath);
      if (!isOwnedItbObject(stored.objectPath)) throw new Error("Protected ITB attachment storage returned an invalid path");
      storedAttachments.push({
        originalName: attachment.originalName,
        contentType: attachment.contentType,
        size: attachment.size,
        objectPath: stored.objectPath,
        sourceAttachmentId: attachment.sourceAttachmentId,
      });
    }

    const result = await db.transaction(async (tx) => {
      const lockKey = `${context.tenantId}:${context.environmentId}:${message.sourceProvider}:${message.sourceMessageId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const concurrent = await tx.select({ id: itbIntakesTable.id }).from(itbIntakesTable).where(and(
        eq(itbIntakesTable.tenantId, context.tenantId),
        eq(itbIntakesTable.environmentId, context.environmentId),
        eq(itbIntakesTable.sourceProvider, message.sourceProvider),
        eq(itbIntakesTable.sourceMessageId, message.sourceMessageId),
      )).limit(1);
      if (concurrent.length) return { kind: "existing" as const, intakeId: concurrent[0].id };

      const [created] = await tx.insert(itbIntakesTable).values({
        tenantId: context.tenantId,
        environmentId: context.environmentId,
        sourceType: message.sourceType,
        sourceProvider: message.sourceProvider,
        sourceMessageId: message.sourceMessageId,
        sourceThreadId: message.sourceThreadId,
        sourceFingerprint: fingerprint([message.sourceProvider, message.sourceMessageId]),
        sourceMailbox: context.sourceMailbox,
        sourceSender: message.sourceSender,
        sourceSenderEmail: message.sourceSenderEmail,
        sourceSubject: message.sourceSubject,
        sourceReceivedAt: new Date(message.sourceReceivedAt),
        sourceBody: message.sourceBody.slice(0, MAX_SOURCE_CHARS),
        extractionJson: JSON.stringify(extraction),
        extractionWarningsJson: JSON.stringify(warnings),
        createdByUserId: context.createdByUserId,
      }).returning({ id: itbIntakesTable.id });

      if (storedAttachments.length) {
        await tx.insert(itbIntakeAttachmentsTable).values(storedAttachments.map((attachment) => ({
          ...attachment,
          intakeId: created.id,
        })));
      }

      if (context.createdByUserId !== null) {
        await tx.insert(platformAuditEventsTable).values({
          actorUserId: context.createdByUserId,
          tenantId: context.tenantId,
          action: context.auditAction,
          details: JSON.stringify({
            intakeId: created.id,
            messageId: message.sourceMessageId,
            provider: message.sourceProvider,
            environmentId: context.environmentId,
          }),
        });
      }
      return { kind: "created" as const, intakeId: created.id };
    });

    if (result.kind === "existing") await cleanupObjects(storedObjectPaths);
    return result;
  } catch (error) {
    await cleanupObjects(storedObjectPaths);
    throw error;
  }
}